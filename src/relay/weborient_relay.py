#!/usr/bin/env python3
"""
WebOrient by DeployMate — Multi-Tenant Live Relay Gateway (`src/relay/weborient_relay.py` v1.0.0)
- MongoDB Atlas Persistence (`MONGODB_URI` -> `db('deploymate').collection('weborient_tenants')` & `'weborient_sessions'`)
  with automatic local JSON fallback (`config/tenants.json` & `config/.session_store.json`)
- Built-in HTTP REST & Health Endpoints on the same port (`/health`, `/api/tenants`, `/api/tenants/register`, `/api/tenants/credits`)
- Multi-Tenant `siteKey` & HTTP `Origin` Verification
- Real-Time Credit Balance Gate & 30-Second Atomic Credit Metering Loop with Low-Balance Wrap-Up
- Bridges 16kHz Mic PCM <-> Gemini 3.8 Live API <-> 24kHz Audio + 11 DOM Function Tools
"""
import asyncio
import base64
import datetime
import json
import os
import secrets
import sys
from http import HTTPStatus
from pathlib import Path
from urllib.parse import parse_qs, urlparse

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
SESSION_CACHE_FILE = PROJECT_ROOT / "config" / ".session_store.json"
TENANTS_FILE = PROJECT_ROOT / "config" / "tenants.json"

# Load environment from weborient/.env and optionally DeployMate/.env for shared MONGODB_URI
for candidate_env in [PROJECT_ROOT / ".env", PROJECT_ROOT.parent / "DeployMate" / ".env"]:
    if candidate_env.exists():
        try:
            with open(candidate_env, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        k = k.strip()
                        v = v.strip().strip('"').strip("'")
                        if k not in os.environ or not os.environ[k]:
                            os.environ[k] = v
        except Exception:
            pass

API_KEY = os.getenv("GEMINI_LIVE_API_KEY") or os.getenv("GEMINI_API_KEY")
MODEL_NAME = os.getenv("GEMINI_MODEL", "gemini-3.8-live")
PORT = int(os.getenv("PORT", "8088"))
MONGODB_URI = os.getenv("MONGODB_URI", "")
SERVER_START_TIME = datetime.datetime.now(datetime.timezone.utc)

if not API_KEY:
    print("[ERROR] GEMINI_LIVE_API_KEY not found in environment or .env file.")
    sys.exit(1)

try:
    import websockets
    from google import genai
    from google.genai import types
except ImportError as e:
    print(f"[ERROR] Missing required libraries: {e}")
    print("Install with: pip install -r requirements.txt")
    sys.exit(1)

# Optional MongoDB Atlas driver (falls back to JSON files if pymongo is not installed or offline)
mongo_db = None
if MONGODB_URI:
    try:
        from pymongo import MongoClient
        mongo_client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=3500)
        mongo_db = mongo_client["deploymate"]
        print("[RELAY] 🍃 Connected to MongoDB Atlas database: 'deploymate'")
    except Exception as e:
        print(f"[RELAY] ⚠️ MongoDB Atlas unavailable ({e}), using local JSON store fallback.")
        mongo_db = None


def load_json_file(path: Path) -> dict:
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_json_file(path: Path, data: dict):
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    except Exception as e:
        print(f"[WARN] Could not persist {path.name}: {e}")


SESSION_MEMORY_STORE = load_json_file(SESSION_CACHE_FILE)
TENANT_STORE = load_json_file(TENANTS_FILE)


def sync_seed_tenants_to_mongo():
    """Seeds default tenants from config/tenants.json into MongoDB Atlas if not present."""
    if mongo_db is None:
        return
    try:
        col = mongo_db["weborient_tenants"]
        for key, tenant in TENANT_STORE.items():
            col.update_one(
                {"siteKey": key},
                {"$setOnInsert": {**tenant, "siteKey": key}},
                upsert=True
            )
    except Exception as e:
        print(f"[WARN] Mongo tenant seed skipped: {e}")


sync_seed_tenants_to_mongo()


def get_tenant(site_key: str) -> dict | None:
    global TENANT_STORE
    TENANT_STORE = load_json_file(TENANTS_FILE) or TENANT_STORE

    if mongo_db is not None:
        try:
            doc = mongo_db["weborient_tenants"].find_one(
                {"$or": [{"siteKey": site_key}, {"siteId": site_key}]},
                {"_id": 0}
            )
            if doc:
                TENANT_STORE[doc["siteKey"]] = doc
                return doc
        except Exception:
            pass

    tenant = TENANT_STORE.get(site_key)
    if not tenant:
        for t in TENANT_STORE.values():
            if t.get("siteId") == site_key:
                return t
    return tenant


def list_all_tenants() -> list[dict]:
    global TENANT_STORE
    TENANT_STORE = load_json_file(TENANTS_FILE) or TENANT_STORE
    if mongo_db is not None:
        try:
            docs = list(mongo_db["weborient_tenants"].find({}, {"_id": 0}).sort("createdAt", -1).limit(100))
            if docs:
                for d in docs:
                    if "siteKey" in d:
                        TENANT_STORE[d["siteKey"]] = d
                return docs
        except Exception:
            pass
    return list(TENANT_STORE.values())


def register_new_tenant(
    company_name: str,
    domain: str,
    email: str = "",
    plan: str = "Starter ($29/mo)",
    theme: str = "signal",
    lang: str = "en-IN",
    initial_credits: float = 25.0
) -> dict:
    global TENANT_STORE
    TENANT_STORE = load_json_file(TENANTS_FILE) or TENANT_STORE

    clean_domain = (
        domain.strip()
        .lower()
        .replace("https://", "")
        .replace("http://", "")
        .split("/")[0]
        .lstrip("www.")
    ) or "localhost"

    slug = "".join(c if c.isalnum() else "-" for c in company_name.lower()).strip("-") or "client"
    token_hex = secrets.token_hex(6)
    site_key = f"wo_live_{token_hex}"

    theme_palette = {
        "signal": {"primaryColor": "#E6391E", "accentColor": "#0A0A0A"},
        "indigo": {"primaryColor": "#6366f1", "accentColor": "#ec4899"},
        "emerald": {"primaryColor": "#10b981", "accentColor": "#0A0A0A"},
        "ink": {"primaryColor": "#0A0A0A", "accentColor": "#E6391E"}
    }.get(theme, {"primaryColor": "#E6391E", "accentColor": "#0A0A0A"})

    tenant_doc = {
        "siteKey": site_key,
        "siteId": f"{slug}-{token_hex[:4]}",
        "companyName": company_name.strip() or "DeployMate Customer",
        "email": email.strip(),
        "plan": plan,
        "creditsMinutes": float(initial_credits),
        "allowedOrigins": [
            clean_domain,
            f"www.{clean_domain}",
            "localhost",
            "127.0.0.1",
            "weborient.deploymate.in",
            "deploymate.in"
        ],
        "defaultLanguage": lang or "en-IN",
        "theme": {
            "name": theme,
            **theme_palette,
            "cursorStyle": "deploymate-signal"
        },
        "manifestFile": "sample-manifest.json",
        "status": "active",
        "createdAt": datetime.datetime.now(datetime.timezone.utc).isoformat()
    }

    TENANT_STORE[site_key] = tenant_doc
    save_json_file(TENANTS_FILE, TENANT_STORE)

    if mongo_db is not None:
        try:
            mongo_db["weborient_tenants"].update_one(
                {"siteKey": site_key},
                {"$set": tenant_doc},
                upsert=True
            )
        except Exception as e:
            print(f"[WARN] Could not save tenant to MongoDB: {e}")

    print(f"[RELAY] 🆕 Registered new tenant: {company_name} ({clean_domain}) -> {site_key}")
    return tenant_doc


def add_tenant_credits(site_key: str, minutes_to_add: float = 150.0) -> dict | None:
    global TENANT_STORE
    tenant = get_tenant(site_key)
    if not tenant:
        return None

    real_key = tenant.get("siteKey", site_key)
    inc_amount = round(float(minutes_to_add), 2)

    if mongo_db is not None:
        try:
            from pymongo import ReturnDocument
            doc = mongo_db["weborient_tenants"].find_one_and_update(
                {"siteKey": real_key},
                {"$inc": {"creditsMinutes": inc_amount}},
                return_document=ReturnDocument.AFTER,
                projection={"_id": 0}
            )
            if doc:
                TENANT_STORE[real_key] = doc
                save_json_file(TENANTS_FILE, TENANT_STORE)
                print(f"[RELAY] 💳 Added +{minutes_to_add}m credits to {real_key} -> New balance: {doc.get('creditsMinutes')}m")
                return doc
        except Exception as e:
            print(f"[WARN] MongoDB credit top-up update failed: {e}")

    current = float(tenant.get("creditsMinutes", 0.0))
    updated = round(current + inc_amount, 2)
    tenant["creditsMinutes"] = updated
    TENANT_STORE[real_key] = tenant
    save_json_file(TENANTS_FILE, TENANT_STORE)
    print(f"[RELAY] 💳 Added +{minutes_to_add}m credits to {real_key} -> New balance: {updated}m")
    return tenant


def verify_tenant_and_origin(site_key: str, origin_header: str) -> tuple[bool, str, dict]:
    """
    Validates tenant siteKey, checks HTTP Origin against allowed domains,
    and verifies positive voice credit balance.
    """
    tenant = get_tenant(site_key)
    if not tenant:
        return False, f"Invalid or unregistered siteKey '{site_key}'. Please register at weborient.deploymate.in", {}

    allowed = tenant.get("allowedOrigins", ["*"])
    if "*" not in allowed and origin_header and not site_key.startswith("wo_test_"):
        parsed_origin = urlparse(origin_header)
        origin_host = (parsed_origin.hostname or origin_header).lower().lstrip("www.")
        matched = False
        for domain in allowed:
            clean_domain = domain.lower().lstrip("www.")
            if (
                origin_host == clean_domain
                or origin_host.endswith(f".{clean_domain}")
                or origin_host in ("localhost", "127.0.0.1")
            ):
                matched = True
                break
        if not matched:
            return False, f"Origin '{origin_header}' is not authorized for siteKey '{site_key}'", tenant

    credits = float(tenant.get("creditsMinutes", 100.0))
    if credits <= 0:
        return False, f"Credit balance exhausted for {tenant.get('companyName', site_key)} (0.0 mins remaining)", tenant

    return True, "OK", tenant


def deduct_tenant_credits(site_key: str, minutes_used: float = 0.5) -> float:
    global TENANT_STORE
    tenant = get_tenant(site_key)
    if not tenant:
        return 0.0

    real_key = tenant.get("siteKey", site_key)

    if mongo_db is not None:
        try:
            from pymongo import ReturnDocument
            # Atomic deduction in MongoDB Atlas preventing concurrent tab race conditions
            dec_amount = round(float(minutes_used), 2)
            res = mongo_db["weborient_tenants"].find_one_and_update(
                {"siteKey": real_key},
                {"$inc": {"creditsMinutes": -dec_amount}},
                return_document=ReturnDocument.AFTER,
                projection={"creditsMinutes": 1, "_id": 0}
            )
            if res and "creditsMinutes" in res:
                raw_bal = float(res["creditsMinutes"])
                updated = max(0.0, round(raw_bal, 2))
                if raw_bal < 0:
                    mongo_db["weborient_tenants"].update_one({"siteKey": real_key}, {"$set": {"creditsMinutes": 0.0}})
                tenant["creditsMinutes"] = updated
                TENANT_STORE[real_key] = tenant
                save_json_file(TENANTS_FILE, TENANT_STORE)
                return updated
        except Exception as e:
            print(f"[WARN] Atomic credit deduction failed in MongoDB, using fallback: {e}")

    current = float(tenant.get("creditsMinutes", 0.0))
    updated = max(0.0, round(current - minutes_used, 2))
    tenant["creditsMinutes"] = updated
    TENANT_STORE[real_key] = tenant
    save_json_file(TENANTS_FILE, TENANT_STORE)
    return updated


def get_or_create_session_memory(session_id: str, site_id: str, lang: str) -> dict:
    if session_id not in SESSION_MEMORY_STORE:
        SESSION_MEMORY_STORE[session_id] = {
            "sessionId": session_id,
            "siteId": site_id,
            "userLanguage": lang or "en-IN",
            "userGoal": "Explore DeployMate WebOrient capabilities, pricing ROI, and voice form co-pilot",
            "interestedTier": "Pro Co-Pilot",
            "completedTodoIds": [],
            "remainingTodos": [],
            "orientedHistory": [],
            "reconnectCount": 0
        }
    else:
        SESSION_MEMORY_STORE[session_id]["reconnectCount"] = SESSION_MEMORY_STORE[session_id].get("reconnectCount", 0) + 1
        if lang:
            SESSION_MEMORY_STORE[session_id]["userLanguage"] = lang

    save_json_file(SESSION_CACHE_FILE, SESSION_MEMORY_STORE)
    if mongo_db is not None:
        try:
            mongo_db["weborient_sessions"].update_one(
                {"sessionId": session_id},
                {"$set": {**SESSION_MEMORY_STORE[session_id], "updatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat()}},
                upsert=True
            )
        except Exception:
            pass
    return SESSION_MEMORY_STORE[session_id]


def load_system_prompt_and_manifest(site_id: str, session_mem: dict, tenant: dict) -> str:
    prompt_file = PROJECT_ROOT / "config" / "agent-prompt.md"
    site_key = tenant.get("siteKey", "")
    is_weborient_showcase = site_key in ("wo_live_deploymate_demo", "wo_test_sandbox") or tenant.get("domain") == "weborient.deploymate.in"
    default_manifest = "sample-manifest.json" if is_weborient_showcase else ""
    manifest_name = tenant.get("manifestFile", default_manifest)
    if not is_weborient_showcase and manifest_name == "sample-manifest.json":
        manifest_name = ""

    tenant_manifest = PROJECT_ROOT / "config" / "manifests" / f"{site_id}.json"
    manifest_file = tenant_manifest if tenant_manifest.exists() else ((PROJECT_ROOT / "config" / manifest_name) if manifest_name else None)

    prompt_text = "You are WebOrient by DeployMate, an intelligent on-screen voice salesperson and website co-pilot."
    if prompt_file.exists():
        prompt_text = prompt_file.read_text(encoding="utf-8")

    manifest_context = ""
    if manifest_file and manifest_file.exists():
        try:
            manifest_data = json.loads(manifest_file.read_text(encoding="utf-8"))
            pages_desc = []
            for p in manifest_data.get("pages", []):
                route_info = f"{p.get('route')} (file: {p.get('file', p.get('route'))})"
                pages_desc.append(f"- {p.get('title')} [{route_info}]: {p.get('summary')}")
                for sec in p.get("sections", []):
                    pages_desc.append(f"  * Component '{sec.get('title')}' ({sec.get('selector')}): {sec.get('description', '')}")

            kb_desc = []
            for kb in manifest_data.get("knowledgeBase", []):
                kb_desc.append(f"- Q: {kb.get('question')}\n  A: {kb.get('answer')}")

            manifest_context = "\n\n### SITE SITEMAP & MULTI-PAGE ROUTES:\n" + "\n".join(pages_desc)
            if kb_desc:
                manifest_context += "\n\n### SITE KNOWLEDGE BASE & FAQ:\n" + "\n".join(kb_desc)
        except Exception as e:
            print(f"[WARN] Failed to parse manifest: {e}")
    else:
        manifest_context = (
            f"\n\n### CLIENT WEBSITE LIVE DOM GROUNDING ({tenant.get('companyName', 'Client Website')} - {tenant.get('domain', '')}):\n"
            f"- You are embedded directly on {tenant.get('companyName', 'this client website')}. Ground all explanations, section walkthroughs, and Q&A strictly on the live `[CURRENT PAGE SECTIONS]`, `[CLIENT WEBSITE METADATA & FAQ]`, and `[INTERACTIVE DOM CONTROLS ON SCREEN]` provided in the session handoff and tool responses.\n"
            f"- Do NOT reference WebOrient demo HTML filenames (`test-demo.html`, `features.html`, `pricing.html`, `docs.html`). Navigate and highlight the actual live sections and controls present on this website!"
        )

    memory_block = (
        f"\n\n### DEPLOYMATE MULTI-TENANT SESSION & LIVE CO-PILOT GUIDANCE "
        f"(Tenant: {tenant.get('companyName', 'DeployMate')} | Session ID: {session_mem['sessionId']} | Credits: {tenant.get('creditsMinutes', 250)} mins):\n"
        f"- PROACTIVE WARM WELCOME ON START (CRITICAL): First-time visitors do NOT know how WebOrient works and will wait in silence. The moment you connect, DO NOT wait for the user to say hello! Speak first immediately with a warm, friendly 1-2 sentence welcome (introduce yourself as WebOrient on DeployMate, note that you can guide them with the Ghost Cursor, and suggest 1-2 things to explore like trying the live voice agent, WhatsApp CRM, or calculating ROI savings). Then pause and follow the user's lead!\n"
        f"- DETECTED & LOCKED LANGUAGE: {session_mem['userLanguage']} (Maintain this language strictly across all turns, popups, and page redirects)\n"
        f"- SILENT SEAMLESS LANGUAGE HANDLING (CRITICAL): When speaking or when language changes, NEVER say aloud 'I will speak in English/Hindi' or announce what language you are using! Simply speak directly in that language without commenting on it or breaking the conversation flow.\n"
        f"- SHOWING vs. SAYING SYNCHRONIZATION RULE: Every single `explanation` badge you pass to `move_and_highlight`, `click_element`, `fill_form_field`, `scroll_page`, or `swipe_or_swap` MUST be written in the exact same language that you are speaking aloud! Never show an English tooltip badge while speaking Hindi/Hinglish!\n"
        f"- ZERO TO-DO OBSESSION — NO RUSHING (CRITICAL): The site sections and features are purely background reference for you so you can answer accurately. There is NO requirement to complete, visit, or check off every section! NEVER rush the user, NEVER mention remaining to-dos or checklists, and NEVER push unrequested sections onto the user. Patiently listen to the user, answer their questions, and follow their curiosity.\n"
        f"- ONE TOOL PER SPOKEN TURN RULE (CRITICAL FOR ZERO-LAG AUDIO SYNC): Call at most ONE visual tool (`move_and_highlight` or `click_element` or `swipe_or_swap`) per turn and IMMEDIATELY speak aloud to the user while the Ghost Cursor moves to that element! NEVER chain 2 or 3 `move_and_highlight` calls in silence before speaking!\n"
        f"- FULL PAGE, POPUP, '/contact' SOUND GATE & CLOSE-BUTTON ('X') CONTROL: Every button, popup, modal, drawer, banner, input, 'Sound on' / 'Keep it silent' gate button, and Close ('X') button on the user's screen is indexed. If the user asks to click 'Sound on', 'Keep it silent', or close any popup/modal/drawer, immediately call `click_element` on its selector.\n"
        f"- USER GOAL / WANT: {session_mem['userGoal']} (Interested Plan: {session_mem['interestedTier']})\n"
        f"- CRITICAL VISUAL GROUNDING RULE: Go with the user in any order they want! Every single time you describe any DOM section, card, tab, carousel, calculator, popup, or input field, call `move_and_highlight`, `click_element`, `swipe_or_swap`, or `fill_form_field` on its actual interactive component selector (NEVER highlight h1/h2 titles or headers)."
    )

    return prompt_text + manifest_context + memory_block


def get_gemini_tools():
    return [
        types.Tool(
            function_declarations=[
                types.FunctionDeclaration(
                    name="move_and_highlight",
                    description="Smoothly glides the Ghost Cursor to the actual interactive DOM component being described, scrolls it into the center of the viewport, spotlights it, and displays an explanation badge in the exact language you are speaking.",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "selector": types.Schema(type=types.Type.STRING, description="CSS selector, data-wo-id, or accessible label of the interactive component"),
                            "explanation": types.Schema(type=types.Type.STRING, description="Concise explanation badge text displayed on screen — MUST be written in the exact same language you are currently speaking aloud!")
                        },
                        required=["selector", "explanation"]
                    )
                ),
                types.FunctionDeclaration(
                    name="click_element",
                    description="Glides cursor to a button, link, tab, toggle, popup trigger, or Close ('X') button, plays a click ripple animation, and triggers full pointer/mouse click events.",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "selector": types.Schema(type=types.Type.STRING, description="CSS selector, data-wo-id, or label of element (including Close 'X' buttons on popups/modals)"),
                            "explanation": types.Schema(type=types.Type.STRING, description="Short badge text in the exact language you are speaking aloud"),
                            "confirmed": types.Schema(type=types.Type.BOOLEAN, description="Set to true when user has verbally confirmed a submit action")
                        },
                        required=["selector"]
                    )
                ),
                types.FunctionDeclaration(
                    name="fill_form_field",
                    description="Fills or sets a form control (text, email, tel, date, textarea, select dropdown, checkbox, radio, or range slider) with typewriter animation and validation checking.",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "selector": types.Schema(type=types.Type.STRING, description="CSS selector, data-wo-id, or label of the form control"),
                            "value": types.Schema(type=types.Type.STRING, description="Value to enter, option to select, or 'true'/'false' for checkboxes"),
                            "explanation": types.Schema(type=types.Type.STRING, description="Short badge text in the exact language you are speaking aloud")
                        },
                        required=["selector", "value"]
                    )
                ),
                types.FunctionDeclaration(
                    name="fill_form_batch",
                    description="Fills multiple form fields sequentially in one coordinated operation and returns validation status.",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "fields": types.Schema(
                                type=types.Type.ARRAY,
                                description="Ordered list of { selector, value } objects to fill",
                                items=types.Schema(
                                    type=types.Type.OBJECT,
                                    properties={
                                        "selector": types.Schema(type=types.Type.STRING),
                                        "value": types.Schema(type=types.Type.STRING)
                                    },
                                    required=["selector", "value"]
                                )
                            ),
                            "explanation": types.Schema(type=types.Type.STRING, description="Short badge text in the exact language you are speaking aloud")
                        },
                        required=["fields"]
                    )
                ),
                types.FunctionDeclaration(
                    name="scroll_page",
                    description="Smoothly scrolls the page up, down, to the top/bottom, or directly to a specific component.",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "direction": types.Schema(type=types.Type.STRING, enum=["up", "down", "top", "bottom"]),
                            "targetSelector": types.Schema(type=types.Type.STRING, description="Optional CSS selector to scroll directly into view"),
                            "amount": types.Schema(type=types.Type.STRING, enum=["small", "half", "page"]),
                            "explanation": types.Schema(type=types.Type.STRING, description="Short badge text in the exact language you are speaking aloud")
                        }
                    )
                ),
                types.FunctionDeclaration(
                    name="swipe_or_swap",
                    description="Swipes a carousel/slider (next, prev, left, right), swaps active tabs, toggles a switch (e.g. Monthly/Annual billing), or adjusts a range slider.",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "selector": types.Schema(type=types.Type.STRING, description="CSS selector of carousel, tablist, tab, switch, or slider"),
                            "action": types.Schema(type=types.Type.STRING, enum=["next", "prev", "left", "right", "toggle", "select"]),
                            "targetValue": types.Schema(type=types.Type.STRING, description="Optional tab name, slide index, or slider value"),
                            "explanation": types.Schema(type=types.Type.STRING, description="Short badge text in the exact language you are speaking aloud")
                        },
                        required=["selector", "action"]
                    )
                ),
                types.FunctionDeclaration(
                    name="navigate_route",
                    description="Navigates the website to another page route (e.g. 'pricing.html', 'features.html', 'docs.html', 'contact.html', 'dashboard.html') while preserving session memory.",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "path": types.Schema(type=types.Type.STRING, description="Target route path or HTML file"),
                            "targetSelector": types.Schema(type=types.Type.STRING, description="Optional component selector to highlight after landing on the new page"),
                            "explanation": types.Schema(type=types.Type.STRING, description="Explanation badge to show upon landing")
                        },
                        required=["path"]
                    )
                ),
                types.FunctionDeclaration(
                    name="scan_visible_elements",
                    description="Scans the active DOM and returns interactive elements with their selectors, labels, values, and states.",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "includeOffscreen": types.Schema(type=types.Type.BOOLEAN, description="Include offscreen elements across the full page")
                        }
                    )
                ),
                types.FunctionDeclaration(
                    name="read_page_content",
                    description="Extracts semantic text, headings, pricing details, FAQs, and manifest knowledge to answer any user question accurately while spotlighting the source component.",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "query": types.Schema(type=types.Type.STRING, description="Topic, keyword, or question to look up"),
                            "selector": types.Schema(type=types.Type.STRING, description="Optional CSS selector of a specific component to read")
                        }
                    )
                ),
                types.FunctionDeclaration(
                    name="guide_tour",
                    description="Runs a multi-step visual walkthrough across multiple elements on the page.",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "steps": types.Schema(
                                type=types.Type.ARRAY,
                                description="Ordered list of tour stops ({ selector, explanation, dwellMs })",
                                items=types.Schema(
                                    type=types.Type.OBJECT,
                                    properties={
                                        "selector": types.Schema(type=types.Type.STRING),
                                        "explanation": types.Schema(type=types.Type.STRING),
                                        "dwellMs": types.Schema(type=types.Type.INTEGER)
                                    },
                                    required=["selector", "explanation"]
                                )
                            )
                        },
                        required=["steps"]
                    )
                ),
                types.FunctionDeclaration(
                    name="update_session_memory",
                    description="Updates cross-page session memory with what the user wants (goal, interested plan tier, native language, or marking a To-Do item complete).",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "goal": types.Schema(type=types.Type.STRING, description="What the user wants to achieve"),
                            "interestedTier": types.Schema(type=types.Type.STRING, description="Plan tier user is interested in"),
                            "language": types.Schema(type=types.Type.STRING, description="User's preferred language code (e.g. en-IN, hi-IN, hinglish, es-ES)"),
                            "todoIdDone": types.Schema(type=types.Type.STRING, description="ID or selector of To-Do item completed"),
                            "note": types.Schema(type=types.Type.STRING, description="Additional preference or fact to remember across pages")
                        }
                    )
                )
            ]
        )
    ]


def build_http_response(status_code: int, payload: dict):
    """Compatible with both websockets >=13 (Response object) and older versions (tuple)."""
    body_bytes = json.dumps(payload, indent=2).encode("utf-8")
    headers_list = [
        ("Content-Type", "application/json; charset=utf-8"),
        ("Content-Length", str(len(body_bytes))),
        ("Access-Control-Allow-Origin", "*"),
        ("Access-Control-Allow-Methods", "GET, POST, OPTIONS"),
        ("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-Token")
    ]
    if hasattr(websockets, "http11") and hasattr(websockets.http11, "Response"):
        from websockets.datastructures import Headers
        return websockets.http11.Response(
            status_code,
            HTTPStatus(status_code).phrase,
            Headers(headers_list),
            body_bytes
        )
    return (HTTPStatus(status_code), headers_list, body_bytes)


async def process_http_request(*args):
    """
    Handles HTTP health checks and tenant onboarding REST requests on the same port
    before WebSocket upgrade:
    - GET /health
    - GET /api/tenants
    - GET /api/tenants/status?siteKey=wo_live_...
    - GET /api/tenants/register?companyName=...&domain=...&email=...&plan=...&theme=...&lang=...
    - GET /api/tenants/credits?siteKey=...&minutes=150
    """
    if len(args) == 2 and hasattr(args[1], "path"):
        request = args[1]
        raw_path = request.path
        headers = request.headers
    else:
        raw_path = args[0]
        headers = args[1]

    upgrade = headers.get("Upgrade", "")
    if upgrade and upgrade.lower() == "websocket":
        return None

    parsed = urlparse(raw_path)
    path = parsed.path.rstrip("/") or "/"
    qs = parse_qs(parsed.query)

    if path in ("/health", "/ping", "/healthz", "/"):
        now_utc = datetime.datetime.now(datetime.timezone.utc)
        uptime_seconds = int((now_utc - SERVER_START_TIME).total_seconds()) if "SERVER_START_TIME" in globals() else 0
        return build_http_response(200, {
            "status": "ok",
            "service": "weborient-relay",
            "model": MODEL_NAME,
            "mongoConnected": mongo_db is not None,
            "tenantCount": len(TENANT_STORE),
            "uptimeSeconds": uptime_seconds,
            "timestamp": now_utc.isoformat()
        })

    if path == "/api/tenants":
        tenants = list_all_tenants()
        return build_http_response(200, {"ok": True, "tenants": tenants})

    if path == "/api/tenants/status":
        site_key = qs.get("siteKey", ["wo_live_deploymate_demo"])[0]
        tenant = get_tenant(site_key)
        if not tenant:
            return build_http_response(404, {"ok": False, "error": f"Tenant '{site_key}' not found"})
        return build_http_response(200, {"ok": True, "tenant": tenant})

    if path == "/api/tenants/register":
        company = qs.get("companyName", ["My Store"])[0]
        domain = qs.get("domain", ["localhost"])[0]
        email = qs.get("email", [""])[0]
        plan = qs.get("plan", ["Starter ($29/mo)"])[0]
        theme = qs.get("theme", ["signal"])[0]
        lang = qs.get("lang", ["en-IN"])[0]
    if not lang or lang == "undefined":
        lang = "en-IN"
        credits = float(qs.get("credits", ["25.0"])[0])
        tenant_doc = register_new_tenant(company, domain, email, plan, theme, lang, credits)
        return build_http_response(201, {"ok": True, "tenant": tenant_doc})

    if path == "/api/tenants/credits":
        site_key = qs.get("siteKey", ["wo_live_deploymate_demo"])[0]
        minutes = float(qs.get("minutes", ["150.0"])[0])
        updated = add_tenant_credits(site_key, minutes)
        if not updated:
            return build_http_response(404, {"ok": False, "error": f"Tenant '{site_key}' not found"})
        return build_http_response(200, {"ok": True, "tenant": updated})

    return None


async def handle_browser_client(websocket):
    raw_path = getattr(websocket, "path", "") or (websocket.request.path if hasattr(websocket, "request") and websocket.request else "/")
    parsed_url = urlparse(raw_path)
    qs = parse_qs(parsed_url.query)

    # Support lightweight WebSocket admin/portal RPC if mode=portal
    mode = qs.get("mode", [""])[0]
    if mode == "portal":
        try:
            async for raw_msg in websocket:
                req = json.loads(raw_msg)
                action = req.get("tenantAction")
                if action == "register":
                    doc = register_new_tenant(
                        req.get("companyName", "Client Store"),
                        req.get("domain", "localhost"),
                        req.get("email", ""),
                        req.get("plan", "Starter ($29/mo)"),
                        req.get("theme", "signal"),
                        req.get("lang", "en-IN"),
                        float(req.get("credits", 25.0))
                    )
                    await websocket.send(json.dumps({"ok": True, "action": "register", "tenant": doc}))
                elif action == "addCredits":
                    doc = add_tenant_credits(req.get("siteKey", "wo_live_deploymate_demo"), float(req.get("minutes", 150.0)))
                    await websocket.send(json.dumps({"ok": bool(doc), "action": "addCredits", "tenant": doc}))
                elif action == "list":
                    await websocket.send(json.dumps({"ok": True, "action": "list", "tenants": list_all_tenants()}))
        except Exception:
            pass
        return

    site_key = qs.get("siteKey", ["wo_live_deploymate_demo"])[0]
    site_id = qs.get("siteId", [site_key])[0]
    session_id = qs.get("sessionId", ["default_session"])[0]
    lang = qs.get("lang", ["en-IN"])[0]
    if not lang or lang == "undefined":
        lang = "en-IN"

    origin_header = ""
    if hasattr(websocket, "request") and websocket.request and hasattr(websocket.request, "headers"):
        origin_header = websocket.request.headers.get("Origin", "")
    elif hasattr(websocket, "request_headers"):
        origin_header = websocket.request_headers.get("Origin", "")

    authorized, auth_msg, tenant = verify_tenant_and_origin(site_key, origin_header)
    if not authorized:
        print(f"[RELAY] ❌ Rejected connection: {auth_msg}")
        await websocket.send(json.dumps({"error": auth_msg, "code": "UNAUTHORIZED_OR_NO_CREDITS"}))
        await websocket.close(code=4002, reason=auth_msg[:120])
        return

    session_mem = get_or_create_session_memory(session_id, site_id, lang)
    print(
        f"[RELAY] ✅ Client connected | tenant={tenant.get('companyName')} ({site_key}) | "
        f"origin={origin_header or 'local'} | credits={tenant.get('creditsMinutes')}m | "
        f"sessionId={session_id} | lang={session_mem['userLanguage']}"
    )

    client = genai.Client(api_key=API_KEY, http_options={"api_version": "v1alpha"})
    full_prompt = load_system_prompt_and_manifest(site_id, session_mem, tenant)
    tools = get_gemini_tools()

    speech_config = types.SpeechConfig(
        voice_config=types.VoiceConfig(
            prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Kavya")
        )
    )

    config = types.LiveConnectConfig(
        response_modalities=[types.Modality.AUDIO],
        speech_config=speech_config,
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
        system_instruction=types.Content(parts=[types.Part.from_text(text=full_prompt)]),
        tools=tools
    )

    try:
        async with client.aio.live.connect(model=MODEL_NAME, config=config) as gemini_session:
            print(f"[RELAY] Active session established with {MODEL_NAME} for {session_id}!")

            async def credit_metering_loop():
                """Meters active voice co-browsing credits every 30 seconds."""
                try:
                    while True:
                        await asyncio.sleep(30)
                        remaining = deduct_tenant_credits(site_key, 0.5)
                        print(f"[RELAY] ⏱️ Credit tick for {site_key}: {remaining} mins remaining")
                        await websocket.send(json.dumps({
                            "creditUpdate": {
                                "siteKey": site_key,
                                "remainingMinutes": remaining
                            }
                        }))
                        if remaining == 0.5:
                            await gemini_session.send_realtime_input(
                                text="[SYSTEM NOTICE: Only 30 seconds of voice credits remain. Wrap up your current action concisely.]"
                            )
                        elif remaining <= 0:
                            await gemini_session.send_realtime_input(
                                text="[SYSTEM NOTICE: Voice credits for this session have ended. Politely say: 'Your voice assistant minutes for this session have ended. You can continue browsing manually.' and stop.]"
                            )
                            await asyncio.sleep(5)
                            await websocket.close(code=4002, reason="Voice credits exhausted")
                            break
                except asyncio.CancelledError:
                    pass
                except Exception as e:
                    print(f"[RELAY] Metering loop stopped: {e}")

            async def forward_gemini_to_browser():
                try:
                    while True:
                        async for response in gemini_session.receive():
                            sc = response.server_content
                            if sc:
                                if getattr(sc, "interrupted", False):
                                    await websocket.send(json.dumps({
                                        "serverContent": {"interrupted": True}
                                    }))

                                if getattr(sc, "input_transcription", None) and getattr(sc.input_transcription, "text", None):
                                    print(f"[RELAY] 🗣️ User said: {sc.input_transcription.text}")
                                    await websocket.send(json.dumps({
                                        "serverContent": {
                                            "inputTranscription": {"text": sc.input_transcription.text}
                                        }
                                    }))

                                if getattr(sc, "output_transcription", None) and getattr(sc.output_transcription, "text", None):
                                    print(f"[RELAY] 🤖 Gemini: {sc.output_transcription.text}")
                                    await websocket.send(json.dumps({
                                        "serverContent": {
                                            "outputTranscription": {"text": sc.output_transcription.text}
                                        }
                                    }))

                                parts = []
                                if sc.model_turn and sc.model_turn.parts:
                                    for part in sc.model_turn.parts:
                                        if part.inline_data and part.inline_data.data:
                                            b64_audio = base64.b64encode(part.inline_data.data).decode("utf-8")
                                            parts.append({
                                                "inlineData": {
                                                    "mimeType": "audio/pcm;rate=24000",
                                                    "data": b64_audio
                                                }
                                            })
                                        if part.text:
                                            parts.append({"text": part.text})

                                if parts:
                                    await websocket.send(json.dumps({
                                        "serverContent": {
                                            "modelTurn": {"parts": parts}
                                        }
                                    }))

                                if getattr(sc, "turn_complete", False):
                                    print(f"[RELAY] Turn complete for {session_id}. Ready for next voice turn.")
                                    break

                            if response.tool_call:
                                calls = []
                                for call in response.tool_call.function_calls:
                                    calls.append({
                                        "id": call.id,
                                        "name": call.name,
                                        "args": call.args
                                    })
                                print(f"[RELAY] Forwarding {len(calls)} tool calls to Ghost Cursor:", [c["name"] for c in calls])
                                await websocket.send(json.dumps({
                                    "toolCall": {"functionCalls": calls}
                                }))
                except websockets.exceptions.ConnectionClosed:
                    pass
                except Exception as exc:
                    print(f"[RELAY] Gemini receiver loop error: {exc}")
                finally:
                    try:
                        await websocket.close()
                    except Exception:
                        pass

            async def forward_browser_to_gemini():
                audio_count = 0
                try:
                    async for raw_msg in websocket:
                        try:
                            data = json.loads(raw_msg)

                            if "realtimeInput" in data:
                                media_chunks = data["realtimeInput"].get("mediaChunks", [])
                                for chunk in media_chunks:
                                    pcm_bytes = base64.b64decode(chunk["data"])
                                    await gemini_session.send_realtime_input(
                                        audio=types.Blob(
                                            mime_type="audio/pcm;rate=16000",
                                            data=pcm_bytes
                                        )
                                    )
                                    audio_count += 1
                                    if audio_count % 50 == 0:
                                        print(f"[RELAY] Streamed {audio_count} mic chunks to Gemini for {session_id}")

                            elif "toolResponse" in data:
                                responses = data["toolResponse"].get("functionResponses", [])
                                print(f"[RELAY] Delivering tool response to Gemini:", [r.get("name") for r in responses])
                                fn_responses = []
                                for r in responses:
                                    out = r.get("response", {}).get("output", {})
                                    digest = out.get("sessionMemoryDigest")
                                    if digest:
                                        session_mem["userLanguage"] = digest.get("userLanguage", session_mem["userLanguage"])
                                        session_mem["userGoal"] = digest.get("userGoal", session_mem["userGoal"])
                                        session_mem["completedTodoIds"] = digest.get("completedTodoIds", session_mem.get("completedTodoIds", []))
                                        session_mem["remainingTodos"] = digest.get("remainingTodos", session_mem.get("remainingTodos", []))
                                    if out.get("selector"):
                                        session_mem["orientedHistory"].append(out.get("selector"))
                                    save_json_file(SESSION_CACHE_FILE, SESSION_MEMORY_STORE)

                                    fn_responses.append(
                                        types.FunctionResponse(
                                            id=r["id"],
                                            name=r.get("name", "move_and_highlight"),
                                            response=r["response"]
                                        )
                                    )
                                await gemini_session.send_tool_response(function_responses=fn_responses)

                            elif "text" in data:
                                turn_complete = bool(data.get("turnComplete", True))
                                print(f"[RELAY] Text frame received (turnComplete={turn_complete}): {data['text'][:120]}")
                                if turn_complete:
                                    await gemini_session.send_realtime_input(text=data["text"])
                                else:
                                    await gemini_session.send_client_content(
                                        turns=types.Content(role="user", parts=[types.Part.from_text(text=data["text"])]),
                                        turn_complete=False
                                    )

                        except websockets.exceptions.ConnectionClosed:
                            break
                        except Exception as err:
                            print(f"[RELAY] Error processing client message: {err}")
                except websockets.exceptions.ConnectionClosed:
                    pass

            meter_task = asyncio.create_task(credit_metering_loop())
            try:
                await asyncio.gather(forward_gemini_to_browser(), forward_browser_to_gemini())
            finally:
                meter_task.cancel()

    except websockets.exceptions.ConnectionClosed:
        print(f"[RELAY] Client {session_id} disconnected (session persisted).")
    except Exception as exc:
        print(f"[RELAY] Session error: {exc}")


async def main():
    print("=================================================================")
    print(" WebOrient by DeployMate — Multi-Tenant Relay Gateway (v1.0.0)")
    print(f" Target Model : {MODEL_NAME}")
    print(f" Storage Mode : {'MongoDB Atlas (deploymate)' if mongo_db is not None else 'Local JSON (config/tenants.json)'}")
    print(f" WebSocket URI: ws://localhost:{PORT}?siteKey=wo_live_deploymate_demo")
    print(f" HTTP Health  : http://localhost:{PORT}/health")
    print("=================================================================")
    async with websockets.serve(
        handle_browser_client,
        "0.0.0.0",
        PORT,
        process_request=process_http_request,
        ping_interval=None,
        ping_timeout=None,
        max_size=10 * 1024 * 1024
    ):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
