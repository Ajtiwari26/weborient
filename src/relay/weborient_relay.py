#!/usr/bin/env python3
"""
WebOrient by DeployMate — Multi-Tenant Live Relay Gateway (`src/relay/weborient_relay.py` v0.5.0)
- Multi-Tenant `siteKey` & HTTP `Origin` Verification (`config/tenants.json`)
- Real-Time Credit Balance Gate & 30-Second Atomic Credit Metering Loop
- Persistent Cross-Page & Refresh-Safe Session Memory (`config/.session_store.json`)
- Bridges 16kHz Mic PCM <-> Gemini 3.8 Live API <-> 24kHz Audio + 11 DOM Function Tools
"""
import asyncio
import base64
import json
import os
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
SESSION_CACHE_FILE = PROJECT_ROOT / "config" / ".session_store.json"
TENANTS_FILE = PROJECT_ROOT / "config" / "tenants.json"

env_file = PROJECT_ROOT / ".env"
if env_file.exists():
    with open(env_file) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ[k.strip()] = v.strip().strip('"').strip("'")

API_KEY = os.getenv("GEMINI_LIVE_API_KEY") or os.getenv("GEMINI_API_KEY")
MODEL_NAME = os.getenv("GEMINI_MODEL", "gemini-3.8-live")
PORT = int(os.getenv("PORT", "8088"))

if not API_KEY:
    print("[ERROR] GEMINI_LIVE_API_KEY not found in environment or .env file.")
    sys.exit(1)

try:
    import websockets
    from google import genai
    from google.genai import types
except ImportError as e:
    print(f"[ERROR] Missing required libraries: {e}")
    print("Install with: pip install websockets google-genai")
    sys.exit(1)


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


def verify_tenant_and_origin(site_key: str, origin_header: str) -> tuple[bool, str, dict]:
    """
    Validates tenant siteKey, checks HTTP Origin against allowed domains,
    and verifies positive voice credit balance.
    """
    global TENANT_STORE
    TENANT_STORE = load_json_file(TENANTS_FILE) or TENANT_STORE

    tenant = TENANT_STORE.get(site_key)
    if not tenant:
        # Check if site_id matches any registered tenant
        for t in TENANT_STORE.values():
            if t.get("siteId") == site_key:
                tenant = t
                break

    if not tenant:
        return False, f"Invalid or unregistered siteKey '{site_key}'. Please register at weborient.deploymate.in", {}

    allowed = tenant.get("allowedOrigins", ["*"])
    if "*" not in allowed and origin_header and not site_key.startswith("wo_test_"):
        parsed_origin = urlparse(origin_header)
        origin_host = (parsed_origin.hostname or origin_header).lower().lstrip("www.")
        matched = False
        for domain in allowed:
            clean_domain = domain.lower().lstrip("www.")
            if origin_host == clean_domain or origin_host.endswith(f".{clean_domain}") or origin_host in ("localhost", "127.0.0.1"):
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
    if site_key in TENANT_STORE:
        current = float(TENANT_STORE[site_key].get("creditsMinutes", 0.0))
        updated = max(0.0, round(current - minutes_used, 2))
        TENANT_STORE[site_key]["creditsMinutes"] = updated
        save_json_file(TENANTS_FILE, TENANT_STORE)
        return updated
    return 250.0


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
    return SESSION_MEMORY_STORE[session_id]


def load_system_prompt_and_manifest(site_id: str, session_mem: dict, tenant: dict) -> str:
    prompt_file = PROJECT_ROOT / "config" / "agent-prompt.md"
    manifest_name = tenant.get("manifestFile", "sample-manifest.json")
    tenant_manifest = PROJECT_ROOT / "config" / "manifests" / f"{site_id}.json"
    manifest_file = tenant_manifest if tenant_manifest.exists() else (PROJECT_ROOT / "config" / manifest_name)

    prompt_text = "You are WebOrient by DeployMate, an intelligent on-screen voice salesperson and website co-pilot."
    if prompt_file.exists():
        prompt_text = prompt_file.read_text(encoding="utf-8")

    manifest_context = ""
    if manifest_file.exists():
        try:
            manifest_data = json.loads(manifest_file.read_text(encoding="utf-8"))
            pages_desc = []
            for p in manifest_data.get("pages", []):
                route_info = f"{p.get('route')} (file: {p.get('file', p.get('route'))})"
                pages_desc.append(f"- {p.get('title')} [{route_info}]: {p.get('summary')}")
                for sec in p.get("sections", []):
                    pages_desc.append(f"  * Section '{sec.get('title')}' ({sec.get('selector')}): {sec.get('description', '')}")

            kb_desc = []
            for kb in manifest_data.get("knowledgeBase", []):
                kb_desc.append(f"- Q: {kb.get('question')}\n  A: {kb.get('answer')}")

            manifest_context = "\n\n### SITE SITEMAP & MULTI-PAGE ROUTES:\n" + "\n".join(pages_desc)
            if kb_desc:
                manifest_context += "\n\n### SITE KNOWLEDGE BASE & FAQ:\n" + "\n".join(kb_desc)
        except Exception as e:
            print(f"[WARN] Failed to parse manifest: {e}")

    memory_block = (
        f"\n\n### DEPLOYMATE MULTI-TENANT SESSION & NON-LINEAR TO-DO MEMORY "
        f"(Tenant: {tenant.get('companyName', 'DeployMate')} | Session ID: {session_mem['sessionId']} | Credits: {tenant.get('creditsMinutes', 250)} mins):\n"
        f"- LOCKED NATIVE LANGUAGE: {session_mem['userLanguage']} (Maintain this language strictly across all page redirects and refreshes)\n"
        f"- USER GOAL / WANT: {session_mem['userGoal']} (Interested Plan: {session_mem['interestedTier']})\n"
        f"- COMPLETED TO-DO ITEMS (Any order): {json.dumps(session_mem.get('completedTodoIds', []))}\n"
        f"- REMAINING TO-DO ITEMS: {json.dumps(session_mem.get('remainingTodos', [])[:6])}\n"
        f"- CRITICAL VISUAL GROUNDING RULE: Go with the user in any order they want! Every single time you describe any DOM section, card, tab, carousel, calculator, or input field, call `move_and_highlight`, `click_element`, `swipe_or_swap`, or `fill_form_field` on its selector so the user sees the actual component highlighted or clicked on screen while you speak."
    )

    return prompt_text + manifest_context + memory_block


def get_gemini_tools():
    return [
        types.Tool(
            function_declarations=[
                types.FunctionDeclaration(
                    name="move_and_highlight",
                    description="Smoothly glides the Ghost Cursor to any DOM element being described, scrolls it into the center of the viewport, spotlights it, and marks its To-Do item complete.",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "selector": types.Schema(type=types.Type.STRING, description="CSS selector, data-wo-id, or accessible label of the element"),
                            "explanation": types.Schema(type=types.Type.STRING, description="Concise explanation badge text displayed beside the element")
                        },
                        required=["selector"]
                    )
                ),
                types.FunctionDeclaration(
                    name="click_element",
                    description="Glides cursor to a button, link, tab, toggle, or interactive control, plays a click ripple animation, and triggers full pointer/mouse click events.",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "selector": types.Schema(type=types.Type.STRING, description="CSS selector, data-wo-id, or label of element"),
                            "confirmed": types.Schema(type=types.Type.BOOLEAN, description="Set to true when user has verbally confirmed a submit action")
                        },
                        required=["selector"]
                    )
                ),
                types.FunctionDeclaration(
                    name="fill_form_field",
                    description="Fills or sets a form control (text, email, tel, textarea, select dropdown, checkbox, radio, or range slider) with typewriter animation and validation checking.",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "selector": types.Schema(type=types.Type.STRING, description="CSS selector, data-wo-id, or label of the form control"),
                            "value": types.Schema(type=types.Type.STRING, description="Value to enter, option to select, or 'true'/'false' for checkboxes")
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
                            )
                        },
                        required=["fields"]
                    )
                ),
                types.FunctionDeclaration(
                    name="scroll_page",
                    description="Smoothly scrolls the page up, down, to the top/bottom, or directly to a specific section or element.",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "direction": types.Schema(type=types.Type.STRING, enum=["up", "down", "top", "bottom"]),
                            "targetSelector": types.Schema(type=types.Type.STRING, description="Optional CSS selector to scroll directly into view"),
                            "amount": types.Schema(type=types.Type.STRING, enum=["small", "half", "page"])
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
                            "targetValue": types.Schema(type=types.Type.STRING, description="Optional tab name, slide index, or slider value")
                        },
                        required=["selector", "action"]
                    )
                ),
                types.FunctionDeclaration(
                    name="navigate_route",
                    description="Navigates the website to another page route (e.g. 'pricing.html', 'features.html', 'docs.html', 'contact.html') while preserving session memory.",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "path": types.Schema(type=types.Type.STRING, description="Target route path or HTML file"),
                            "targetSelector": types.Schema(type=types.Type.STRING, description="Optional section selector to highlight after landing on the new page"),
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
                    description="Extracts semantic text, headings, pricing details, FAQs, and manifest knowledge to answer any user question accurately while spotlighting the source section.",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "query": types.Schema(type=types.Type.STRING, description="Topic, keyword, or question to look up"),
                            "selector": types.Schema(type=types.Type.STRING, description="Optional CSS selector of a specific section to read")
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


async def handle_browser_client(websocket):
    raw_path = getattr(websocket, "path", "") or (websocket.request.path if hasattr(websocket, "request") and websocket.request else "/")
    parsed_url = urlparse(raw_path)
    qs = parse_qs(parsed_url.query)

    site_key = qs.get("siteKey", ["wo_live_deploymate_demo"])[0]
    site_id = qs.get("siteId", [site_key])[0]
    session_id = qs.get("sessionId", ["default_session"])[0]
    lang = qs.get("lang", ["en-IN"])[0]

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

    client = genai.Client(api_key=API_KEY)
    full_prompt = load_system_prompt_and_manifest(site_id, session_mem, tenant)
    tools = get_gemini_tools()

    config = types.LiveConnectConfig(
        response_modalities=[types.Modality.AUDIO],
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
                                print(f"[RELAY] Text prompt received: {data['text']}")
                                await gemini_session.send_realtime_input(text=data["text"])

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
        print(f"[RELAY] Client {session_id} disconnected (session persisted in config/.session_store.json).")
    except Exception as exc:
        print(f"[RELAY] Session error: {exc}")


async def main():
    print("=================================================================")
    print(" WebOrient by DeployMate — Multi-Tenant Relay Gateway (v0.5.0)")
    print(f" Target Model : {MODEL_NAME}")
    print(f" WebSocket URI: ws://localhost:{PORT}?siteKey=wo_live_deploymate_demo")
    print("=================================================================")
    async with websockets.serve(
        handle_browser_client,
        "0.0.0.0",
        PORT,
        ping_interval=None,
        ping_timeout=None,
        max_size=10 * 1024 * 1024
    ):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
