#!/usr/bin/env python3
"""
WebOrient by DeployMate — Production Multi-Tenant Live Relay Gateway (`src/relay/weborient_relay.py` v1.0.0)
- Multi-Key Gemini Live API Load Balancer (`GeminiKeyPool`) with MongoDB `weborient_api_keys` persistence,
  least-loaded routing, 60s error cooldowns, and <150ms automatic failover on 429/403/503 errors
- "VIP + Local Secretary" VAD Gate Integration (`vadControl`):
  Pauses tenant credit burn (`is_secretary_hold = True`) and sends `audio_stream_end=True` after 10s of silence
  so 0 tokens and 0 credits are burned while visitors read the page
- Context Window Compression (`ContextWindowCompressionConfig`) & Transparent Session Resumption
- Per-IP Connection Rate Limiter + PII/Card/OTP Redaction (`redact_sensitive_text`)
- Full Session Telemetry, DOM Action Audit Log (`domEvents[]`), Drop-Off Section Tracking & Partial Lead Capture
"""
import asyncio
import base64
import copy
import datetime
import hashlib
import hmac
import json
import os
import re
import secrets
import sys
import threading
import time
from http import HTTPStatus
from pathlib import Path
from urllib.parse import parse_qs, urlparse

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
SESSION_CACHE_FILE = PROJECT_ROOT / "config" / ".session_store.json"
TENANTS_FILE = PROJECT_ROOT / "config" / "tenants.json"
API_KEYS_FILE = PROJECT_ROOT / "config" / ".api_keys_store.json"

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

# Ensure google-genai uses Gemini Developer API (api_key) mode rather than Vertex AI
for _gcp_var in (
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GCP_SERVICE_ACCOUNT_JSON",
    "GCP_PROJECT",
    "GCP_LOCATION",
    "GOOGLE_CLOUD_PROJECT",
    "GOOGLE_CLOUD_LOCATION",
):
    os.environ.pop(_gcp_var, None)

PRIMARY_API_KEY = os.getenv("GEMINI_LIVE_API_KEY") or os.getenv("GEMINI_API_KEY") or ""
EXTRA_API_KEYS_RAW = os.getenv("GEMINI_API_KEYS") or os.getenv("GEMINI_BACKUP_API_KEYS") or ""
MODEL_NAME = os.getenv("GEMINI_MODEL", "gemini-3.8-live")
_RAW_VOICE = (os.getenv("GEMINI_LIVE_VOICE") or "Aoede").strip()
# In AgentLine, the receptionist persona is "Kavya" whose Gemini Live prebuilt voice ID is "Aoede"
VOICE_NAME = "Aoede" if _RAW_VOICE.lower() in ("", "kavya", "default") else _RAW_VOICE
PORT = int(os.getenv("PORT", "8088"))
MONGODB_URI = os.getenv("MONGODB_URI", "")
ADMIN_SECRET = (
    os.getenv("ADMIN_KEY")
    or os.getenv("adminkey")
    or os.getenv("WEBORIENT_ADMIN_SECRET")
    or ""
)
SERVER_START_TIME = datetime.datetime.now(datetime.timezone.utc)


def _safe_equal(a: str, b: str) -> bool:
    """Constant-time string comparison matching DeployMate/api-lib/adminAuth.ts."""
    return hmac.compare_digest(
        hashlib.sha256(a.encode("utf-8")).digest(),
        hashlib.sha256(b.encode("utf-8")).digest()
    )


def _verify_admin_hmac_token(token: str, secret: str) -> bool:
    if not token or "." not in token or not secret:
        return False
    exp, sig = token.split(".", 1)
    if not re.fullmatch(r"\d{10,16}", exp):
        return False
    if int(exp) < int(time.time() * 1000):
        return False
    expected_sig = base64.urlsafe_b64encode(
        hmac.new(secret.encode("utf-8"), exp.encode("utf-8"), hashlib.sha256).digest()
    ).decode("ascii").rstrip("=")
    return _safe_equal(sig, expected_sig)


def verify_admin_token_or_key(candidate: str) -> bool:
    """Validates either a short-lived HMAC x-admin-token or raw ADMIN_SECRET."""
    if not ADMIN_SECRET or not candidate:
        return False
    clean = str(candidate).strip()
    if not clean:
        return False
    return _verify_admin_hmac_token(clean, ADMIN_SECRET) or _safe_equal(clean, ADMIN_SECRET)


def _extract_header(headers, name: str) -> str:
    if not headers:
        return ""
    target = name.lower()
    if hasattr(headers, "items"):
        for k, v in headers.items():
            if str(k).lower() == target:
                return str(v)
    return ""


def is_admin_request(headers, qs: dict | None = None, extra_token: str = "") -> bool:
    """Returns True only when request carries a valid HMAC admin token or raw ADMIN_SECRET."""
    candidates = [
        _extract_header(headers, "X-Admin-Token"),
        _extract_header(headers, "X-Admin-Key"),
    ]
    auth_hdr = _extract_header(headers, "Authorization")
    if auth_hdr.lower().startswith("bearer "):
        candidates.append(auth_hdr[7:].strip())
    if qs:
        candidates.append((qs.get("adminToken") or [""])[0])
        candidates.append((qs.get("adminKey") or [""])[0])
    if extra_token:
        candidates.append(extra_token)
    return any(verify_admin_token_or_key(c) for c in candidates if c)

if not PRIMARY_API_KEY and not EXTRA_API_KEYS_RAW:
    print("[ERROR] GEMINI_LIVE_API_KEY not found in environment or .env file.")
    sys.exit(1)

try:
    import websockets
    from google import genai
    from google.genai import types
except ImportError as e:
    print(f"[ERROR] Missing required libraries: {e}")
    sys.exit(1)

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


_FILE_SAVE_LOCK = threading.Lock()


def load_json_file(path: Path) -> dict:
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_json_file(path: Path, data: dict):
    try:
        with _FILE_SAVE_LOCK:
            path.parent.mkdir(parents=True, exist_ok=True)
            serialized = json.dumps(data, indent=2)
            tmp_path = path.with_suffix(path.suffix + ".tmp")
            tmp_path.write_text(serialized, encoding="utf-8")
            tmp_path.replace(path)
    except Exception as e:
        print(f"[WARN] Could not persist {path.name}: {e}")


SESSION_MEMORY_STORE = load_json_file(SESSION_CACHE_FILE)
TENANT_STORE = load_json_file(TENANTS_FILE)
API_KEY_STORE = load_json_file(API_KEYS_FILE)

# Per-IP Rate Limiter State: { ip_hash: {"active": int, "timestamps": [float]} }
IP_RATE_STATE: dict[str, dict] = {}
MAX_CONCURRENT_PER_IP = int(os.getenv("WEBORIENT_MAX_CONCURRENT_PER_IP", "5"))
MAX_CONNECTIONS_PER_HOUR_IP = int(os.getenv("WEBORIENT_MAX_HOURLY_PER_IP", "60"))

# PII & Sensitive Digit Redactor (masks 10-16 digit card/Aadhaar/phone/account sequences in stored logs)
SENSITIVE_DIGITS_RE = re.compile(r"\b(?:\d[ -]*?){12,16}\b")


def redact_sensitive_text(text: str) -> str:
    if not text:
        return ""
    return SENSITIVE_DIGITS_RE.sub("[REDACTED-SENSITIVE-DIGITS]", str(text))


def mask_api_key(raw_key: str) -> str:
    k = str(raw_key or "").strip()
    if len(k) <= 10:
        return "***"
    return f"{k[:6]}...{k[-4:]}"


class GeminiKeyPool:
    """
    Multi-Key Gemini Live API Load Balancer & Automatic Failover Pool.
    Persists keys in MongoDB `weborient_api_keys` (with local JSON fallback),
    selects the least-loaded active key, and places keys on a 60s cooldown on 429/503 errors.
    """
    def __init__(self):
        self.keys: dict[str, dict] = {}
        self._rr_counter = 0
        self.reload_keys()
        self._reset_active_sessions_on_boot()

    def _reset_active_sessions_on_boot(self):
        """Resets stale in-flight session counters and transient cooldowns after process restart."""
        changed = False
        for kid, doc in self.keys.items():
            if int(doc.get("activeSessions", 0)) != 0 or float(doc.get("cooldownUntil", 0.0) or 0.0) > 0:
                doc["activeSessions"] = 0
                doc["cooldownUntil"] = 0.0
                API_KEY_STORE[kid] = doc
                changed = True
        if changed:
            save_json_file(API_KEYS_FILE, API_KEY_STORE)
        if mongo_db is not None:
            try:
                mongo_db["weborient_api_keys"].update_many(
                    {},
                    {"$set": {"activeSessions": 0, "cooldownUntil": 0.0}}
                )
            except Exception as e:
                print(f"[WARN] Could not reset stale activeSessions in Mongo: {e}")

    def reload_keys(self):
        global API_KEY_STORE
        API_KEY_STORE = load_json_file(API_KEYS_FILE) or API_KEY_STORE
        mongo_docs: dict[str, dict] = {}
        mongo_ok = False
        if mongo_db is not None:
            try:
                docs = list(mongo_db["weborient_api_keys"].find({}, {"_id": 0}).sort("priority", 1))
                mongo_ok = True
                for d in docs:
                    if "keyId" in d and "apiKey" in d:
                        mongo_docs[d["keyId"]] = d
                        self.keys[d["keyId"]] = d
                        API_KEY_STORE[d["keyId"]] = d
            except Exception as e:
                print(f"[WARN] Could not load weborient_api_keys from Mongo: {e}")

        # Prune dashboard-deleted keys when MongoDB is authoritative and non-empty
        if mongo_ok and mongo_docs:
            stale_ids = [kid for kid in list(self.keys.keys()) if kid not in mongo_docs]
            for kid in stale_ids:
                self.keys.pop(kid, None)
                API_KEY_STORE.pop(kid, None)
            if stale_ids:
                save_json_file(API_KEYS_FILE, API_KEY_STORE)

        for kid, kdoc in API_KEY_STORE.items():
            if kid not in self.keys and "apiKey" in kdoc:
                self.keys[kid] = kdoc

        # Seed primary & backup env keys if not already present
        env_candidates = []
        if PRIMARY_API_KEY:
            env_candidates.append(("Primary Env Key (GCP #1)", PRIMARY_API_KEY, 1))
        if EXTRA_API_KEYS_RAW:
            for idx, k in enumerate([x.strip() for x in EXTRA_API_KEYS_RAW.split(",") if x.strip()], start=2):
                env_candidates.append((f"Backup Env Key #{idx}", k, idx))

        existing_raw = {v.get("apiKey") for v in self.keys.values()}
        for label, raw_key, prio in env_candidates:
            if raw_key not in existing_raw:
                key_hash = hashlib.sha1(raw_key.encode("utf-8")).hexdigest()[:8]
                kid = f"gkey_{key_hash}"
                doc = {
                    "keyId": kid,
                    "label": label,
                    "apiKey": raw_key,
                    "maskedKey": mask_api_key(raw_key),
                    "status": "active",
                    "priority": prio,
                    "activeSessions": 0,
                    "totalSessions": 0,
                    "totalMinutes": 0.0,
                    "errorCount": 0,
                    "lastError": None,
                    "cooldownUntil": 0.0,
                    "createdAt": datetime.datetime.now(datetime.timezone.utc).isoformat()
                }
                self.keys[kid] = doc
                self._persist_key(doc)

    def _persist_key(self, doc: dict):
        kid = doc["keyId"]
        self.keys[kid] = doc
        API_KEY_STORE[kid] = doc
        save_json_file(API_KEYS_FILE, API_KEY_STORE)
        if mongo_db is not None:
            try:
                config_fields = {
                    "keyId": kid,
                    "label": doc.get("label", kid),
                    "apiKey": doc.get("apiKey", ""),
                    "maskedKey": doc.get("maskedKey") or mask_api_key(doc.get("apiKey", "")),
                    "status": doc.get("status", "active"),
                    "priority": int(doc.get("priority", 1)),
                }
                init_fields = {
                    "activeSessions": int(doc.get("activeSessions", 0)),
                    "totalSessions": int(doc.get("totalSessions", 0)),
                    "totalMinutes": float(doc.get("totalMinutes", 0.0)),
                    "errorCount": int(doc.get("errorCount", 0)),
                    "lastError": doc.get("lastError"),
                    "cooldownUntil": float(doc.get("cooldownUntil", 0.0)),
                    "createdAt": doc.get("createdAt") or datetime.datetime.now(datetime.timezone.utc).isoformat(),
                }
                mongo_db["weborient_api_keys"].update_one(
                    {"keyId": kid},
                    {"$set": config_fields, "$setOnInsert": init_fields},
                    upsert=True
                )
            except Exception:
                pass

    def _update_key_fields(self, key_id: str, set_fields: dict | None = None, inc_fields: dict | None = None):
        """Applies targeted field updates/increments without clobbering concurrent workers or admin edits."""
        doc = self.keys.get(key_id)
        if doc:
            API_KEY_STORE[key_id] = doc
            save_json_file(API_KEYS_FILE, API_KEY_STORE)
        if mongo_db is not None:
            update_op: dict = {}
            if set_fields:
                update_op["$set"] = set_fields
            if inc_fields:
                update_op["$inc"] = inc_fields
            if update_op:
                try:
                    mongo_db["weborient_api_keys"].update_one({"keyId": key_id}, update_op)
                except Exception:
                    pass

    def list_public_keys(self) -> list[dict]:
        self.reload_keys()
        now = time.time()
        out = []
        for k in sorted(self.keys.values(), key=lambda x: (x.get("priority", 1), x.get("createdAt", ""))):
            cooldown_rem = max(0, int((k.get("cooldownUntil") or 0) - now))
            out.append({
                "keyId": k["keyId"],
                "label": k.get("label", k["keyId"]),
                "maskedKey": k.get("maskedKey") or mask_api_key(k.get("apiKey", "")),
                "status": "cooldown" if cooldown_rem > 0 and k.get("status") == "active" else k.get("status", "active"),
                "cooldownRemainingSec": cooldown_rem,
                "priority": k.get("priority", 1),
                "activeSessions": k.get("activeSessions", 0),
                "totalSessions": k.get("totalSessions", 0),
                "totalMinutes": round(float(k.get("totalMinutes", 0.0)), 1),
                "errorCount": k.get("errorCount", 0),
                "lastError": k.get("lastError"),
                "createdAt": k.get("createdAt")
            })
        return out

    def add_key(self, label: str, api_key: str, priority: int = 1) -> dict:
        clean_key = str(api_key or "").strip()
        if not clean_key:
            raise ValueError("API key cannot be empty")
        key_hash = hashlib.sha1(clean_key.encode("utf-8")).hexdigest()[:8]
        kid = f"gkey_{key_hash}"
        doc = {
            "keyId": kid,
            "label": (label or f"Gemini Key {kid}").strip(),
            "apiKey": clean_key,
            "maskedKey": mask_api_key(clean_key),
            "status": "active",
            "priority": int(priority or 1),
            "activeSessions": 0,
            "totalSessions": 0,
            "totalMinutes": 0.0,
            "errorCount": 0,
            "lastError": None,
            "cooldownUntil": 0.0,
            "createdAt": datetime.datetime.now(datetime.timezone.utc).isoformat()
        }
        self._persist_key(doc)
        print(f"[KEY-POOL] 🔑 Added/Updated Gemini API Key: {doc['label']} ({doc['maskedKey']})")
        return doc

    def update_key(self, key_id: str, label: str = None, status: str = None, priority: int = None) -> dict | None:
        self.reload_keys()
        doc = self.keys.get(key_id)
        if not doc:
            return None
        if label is not None and str(label).strip():
            doc["label"] = str(label).strip()
        if status in ("active", "paused"):
            doc["status"] = status
            if status == "active":
                doc["cooldownUntil"] = 0.0
                self._update_key_fields(key_id, set_fields={"cooldownUntil": 0.0})
        if priority is not None:
            doc["priority"] = int(priority)
        self._persist_key(doc)
        return doc

    def delete_key(self, key_id: str) -> bool:
        self.reload_keys()
        if len(self.keys) <= 1:
            return False  # Never delete the last remaining API key
        if key_id in self.keys:
            del self.keys[key_id]
        if key_id in API_KEY_STORE:
            del API_KEY_STORE[key_id]
            save_json_file(API_KEYS_FILE, API_KEY_STORE)
        if mongo_db is not None:
            try:
                mongo_db["weborient_api_keys"].delete_one({"keyId": key_id})
            except Exception:
                pass
        return True

    def get_ordered_candidate_keys(self) -> list[dict]:
        self.reload_keys()
        now = time.time()
        active_healthy = [
            k for k in self.keys.values()
            if k.get("status", "active") == "active" and float(k.get("cooldownUntil") or 0) <= now
        ]
        if not active_healthy:
            # Fallback: if all active keys are in cooldown, try the one whose cooldown expires soonest
            active_healthy = [k for k in self.keys.values() if k.get("status", "active") == "active"]
            if not active_healthy:
                active_healthy = list(self.keys.values())

        # Sort by least active sessions, then priority, with round-robin tie-breaker
        self._rr_counter = (self._rr_counter + 1) % 1000
        active_healthy.sort(
            key=lambda k: (
                int(k.get("activeSessions", 0)),
                int(k.get("priority", 1)),
                (hash(k["keyId"]) + self._rr_counter) % 17
            )
        )
        return active_healthy

    def mark_session_started(self, key_id: str):
        doc = self.keys.get(key_id)
        if not doc:
            return
        doc["activeSessions"] = max(0, int(doc.get("activeSessions", 0))) + 1
        doc["totalSessions"] = int(doc.get("totalSessions", 0)) + 1
        self._update_key_fields(key_id, inc_fields={"activeSessions": 1, "totalSessions": 1})

    def mark_session_ended(self, key_id: str, minutes_used: float = 0.0):
        doc = self.keys.get(key_id)
        if not doc:
            return
        new_active = max(0, int(doc.get("activeSessions", 1)) - 1)
        inc_mins = round(float(minutes_used), 2)
        doc["activeSessions"] = new_active
        doc["totalMinutes"] = round(float(doc.get("totalMinutes", 0.0)) + inc_mins, 2)
        self._update_key_fields(
            key_id,
            set_fields={"activeSessions": new_active},
            inc_fields={"totalMinutes": inc_mins} if inc_mins else None,
        )

    def mark_key_error(self, key_id: str, error_msg: str, cooldown_sec: int = 60):
        doc = self.keys.get(key_id)
        if not doc:
            return
        last_err = f"{datetime.datetime.now(datetime.timezone.utc).strftime('%H:%M:%S UTC')}: {str(error_msg)[:140]}"
        cooldown_until = time.time() + cooldown_sec
        doc["errorCount"] = int(doc.get("errorCount", 0)) + 1
        doc["lastError"] = last_err
        doc["cooldownUntil"] = cooldown_until
        self._update_key_fields(
            key_id,
            set_fields={"lastError": last_err, "cooldownUntil": cooldown_until},
            inc_fields={"errorCount": 1},
        )
        print(f"[KEY-POOL] ⚠️ Key {doc.get('label')} ({doc.get('maskedKey')}) placed on {cooldown_sec}s cooldown: {error_msg}")


KEY_POOL = GeminiKeyPool()


def check_ip_rate_limit(remote_ip: str) -> tuple[bool, str]:
    if not remote_ip or remote_ip in ("127.0.0.1", "::1", "localhost"):
        return True, "OK"
    ip_hash = hashlib.sha256(remote_ip.encode("utf-8")).hexdigest()[:16]
    now = time.time()
    entry = IP_RATE_STATE.setdefault(ip_hash, {"active": 0, "timestamps": []})
    entry["timestamps"] = [ts for ts in entry["timestamps"] if now - ts < 3600]
    if entry["active"] >= MAX_CONCURRENT_PER_IP:
        return False, f"Rate limit exceeded: max {MAX_CONCURRENT_PER_IP} concurrent voice sessions per IP."
    if len(entry["timestamps"]) >= MAX_CONNECTIONS_PER_HOUR_IP:
        return False, "Hourly voice session rate limit reached for this IP. Please try again shortly."
    entry["active"] += 1
    entry["timestamps"].append(now)
    return True, ip_hash


def release_ip_slot(ip_hash: str):
    if ip_hash and ip_hash in IP_RATE_STATE:
        IP_RATE_STATE[ip_hash]["active"] = max(0, IP_RATE_STATE[ip_hash]["active"] - 1)


def sync_seed_tenants_to_mongo():
    if mongo_db is None:
        return
    try:
        col = mongo_db["weborient_tenants"]
        for key, tenant in TENANT_STORE.items():
            mutable_keys = ("siteId", "companyName", "domain", "allowedOrigins", "theme", "defaultLanguage", "manifestFile")
            set_fields = {"siteKey": key}
            for k in mutable_keys:
                if k in tenant:
                    set_fields[k] = tenant[k]
            insert_only = {k: v for k, v in tenant.items() if k not in set_fields}
            update_doc = {"$set": set_fields}
            if insert_only:
                update_doc["$setOnInsert"] = insert_only
            col.update_one(
                {"siteKey": key},
                update_doc,
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


def list_recent_sessions(site_key: str = "", limit: int = 50) -> list[dict]:
    if mongo_db is not None:
        try:
            query = {"siteKey": site_key} if site_key else {}
            docs = list(
                mongo_db["weborient_sessions"]
                .find(query, {"_id": 0})
                .sort("updatedAt", -1)
                .limit(limit)
            )
            if docs:
                return docs
        except Exception:
            pass
    all_sess = list(SESSION_MEMORY_STORE.values())
    if site_key:
        all_sess = [s for s in all_sess if s.get("siteKey") == site_key or s.get("siteId") == site_key]
    all_sess.sort(key=lambda s: s.get("updatedAt", ""), reverse=True)
    return all_sess[:limit]


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
        "totalCreditsBurned": 0.0,
        "totalSecretarySavedSeconds": 0,
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


def add_tenant_credits(site_key: str, minutes_to_add: float = 150.0, plan: str = None) -> dict | None:
    global TENANT_STORE
    tenant = get_tenant(site_key)
    if not tenant:
        return None

    real_key = tenant.get("siteKey", site_key)
    inc_amount = round(float(minutes_to_add), 2)

    if mongo_db is not None:
        try:
            from pymongo import ReturnDocument
            update_op: dict = {"$inc": {"creditsMinutes": inc_amount}}
            if plan:
                update_op["$set"] = {"plan": plan}
            doc = mongo_db["weborient_tenants"].find_one_and_update(
                {"siteKey": real_key},
                update_op,
                return_document=ReturnDocument.AFTER,
                projection={"_id": 0}
            )
            if doc:
                TENANT_STORE[real_key] = doc
                save_json_file(TENANTS_FILE, TENANT_STORE)
                return doc
        except Exception as e:
            print(f"[WARN] MongoDB credit top-up update failed: {e}")

    current = float(tenant.get("creditsMinutes", 0.0))
    updated = round(current + inc_amount, 2)
    tenant["creditsMinutes"] = updated
    if plan:
        tenant["plan"] = plan
    TENANT_STORE[real_key] = tenant
    save_json_file(TENANTS_FILE, TENANT_STORE)
    return tenant


def verify_tenant_and_origin(site_key: str, origin_header: str) -> tuple[bool, str, dict]:
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


def deduct_tenant_credits(site_key: str, minutes_used: float = 0.5, saved_seconds_delta: int = 0) -> float:
    global TENANT_STORE
    tenant = get_tenant(site_key)
    if not tenant:
        return 0.0

    real_key = tenant.get("siteKey", site_key)
    dec_amount = round(float(minutes_used), 2)

    if mongo_db is not None:
        try:
            from pymongo import ReturnDocument
            res = mongo_db["weborient_tenants"].find_one_and_update(
                {"siteKey": real_key},
                {
                    "$inc": {
                        "creditsMinutes": -dec_amount,
                        "totalCreditsBurned": dec_amount,
                        "totalSecretarySavedSeconds": int(saved_seconds_delta)
                    }
                },
                return_document=ReturnDocument.AFTER,
                projection={"_id": 0}
            )
            if res and "creditsMinutes" in res:
                raw_bal = float(res["creditsMinutes"])
                updated = max(0.0, round(raw_bal, 2))
                if raw_bal < 0:
                    mongo_db["weborient_tenants"].update_one({"siteKey": real_key}, {"$set": {"creditsMinutes": 0.0}})
                TENANT_STORE[real_key] = res
                TENANT_STORE[real_key]["creditsMinutes"] = updated
                save_json_file(TENANTS_FILE, TENANT_STORE)
                return updated
        except Exception as e:
            print(f"[WARN] Atomic credit deduction failed in MongoDB, using fallback: {e}")

    current = float(tenant.get("creditsMinutes", 0.0))
    updated = max(0.0, round(current - dec_amount, 2))
    tenant["creditsMinutes"] = updated
    tenant["totalCreditsBurned"] = round(float(tenant.get("totalCreditsBurned", 0.0)) + dec_amount, 2)
    tenant["totalSecretarySavedSeconds"] = int(tenant.get("totalSecretarySavedSeconds", 0)) + int(saved_seconds_delta)
    TENANT_STORE[real_key] = tenant
    save_json_file(TENANTS_FILE, TENANT_STORE)
    return updated


def get_or_create_session_memory(session_id: str, site_key: str, site_id: str, lang: str, company_name: str = "") -> dict:
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    if session_id not in SESSION_MEMORY_STORE:
        SESSION_MEMORY_STORE[session_id] = {
            "sessionId": session_id,
            "siteKey": site_key,
            "siteId": site_id,
            "companyName": company_name or site_id,
            "userLanguage": lang or "en-IN",
            "userGoal": "Explore solutions, live demos, and pricing ROI",
            "interestedTier": "Pro Co-Pilot",
            "completedTodoIds": [],
            "remainingTodos": [],
            "orientedHistory": [],
            "domEvents": [],
            "failedSelectorsCount": 0,
            "lastSectionViewed": None,
            "partialLead": {"fullName": "", "email": "", "phone": "", "company": "", "submitted": False},
            "transcripts": [],
            "creditsBurned": 0.0,
            "secretarySavedSeconds": 0,
            "apiKeyId": None,
            "apiKeyLabel": None,
            "status": "active",
            "terminationReason": None,
            "reconnectCount": 0,
            "latestDomSnapshot": "",
            "startedAt": now_iso,
            "updatedAt": now_iso
        }
    else:
        SESSION_MEMORY_STORE[session_id]["reconnectCount"] = SESSION_MEMORY_STORE[session_id].get("reconnectCount", 0) + 1
        SESSION_MEMORY_STORE[session_id]["status"] = "active"
        SESSION_MEMORY_STORE[session_id]["updatedAt"] = now_iso
        if lang:
            SESSION_MEMORY_STORE[session_id]["userLanguage"] = lang

    persist_session_memory(session_id)
    return SESSION_MEMORY_STORE[session_id]


_PENDING_PERSIST_TIMERS: dict[str, asyncio.TimerHandle] = {}
_PERSIST_LOCK = threading.Lock()


def _sync_persist_snapshot(session_id: str, session_snapshot: dict, full_store_snapshot: dict):
    with _PERSIST_LOCK:
        save_json_file(SESSION_CACHE_FILE, full_store_snapshot)
        if mongo_db is not None:
            try:
                mongo_db["weborient_sessions"].update_one(
                    {"sessionId": session_id},
                    {"$set": session_snapshot},
                    upsert=True
                )
            except Exception:
                pass


def _prune_session_memory_store(active_session_id: str, max_sessions: int = 50):
    if len(SESSION_MEMORY_STORE) <= max_sessions:
        return
    inactive = [
        (sid, doc.get("updatedAt", ""))
        for sid, doc in SESSION_MEMORY_STORE.items()
        if sid != active_session_id and doc.get("status") != "active"
    ]
    inactive.sort(key=lambda item: item[1])
    to_remove = len(SESSION_MEMORY_STORE) - max_sessions
    for sid, _ in inactive[:to_remove]:
        SESSION_MEMORY_STORE.pop(sid, None)


def _capture_snapshots_on_loop(session_id: str) -> tuple[dict, dict] | None:
    if session_id not in SESSION_MEMORY_STORE:
        return None
    SESSION_MEMORY_STORE[session_id]["updatedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    _prune_session_memory_store(session_id, max_sessions=50)
    # Deep-copy the bounded store so off-loop json.dumps never races with concurrent active sessions.
    store_snap = copy.deepcopy(SESSION_MEMORY_STORE)
    return store_snap[session_id], store_snap


async def _flush_session_memory_async(session_id: str):
    timer = _PENDING_PERSIST_TIMERS.pop(session_id, None)
    if timer is not None:
        timer.cancel()
    snaps = _capture_snapshots_on_loop(session_id)
    if not snaps:
        return
    await asyncio.to_thread(_sync_persist_snapshot, session_id, snaps[0], snaps[1])


def persist_session_memory(session_id: str, immediate: bool = False):
    if session_id not in SESSION_MEMORY_STORE:
        return
    SESSION_MEMORY_STORE[session_id]["updatedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        snaps = _capture_snapshots_on_loop(session_id)
        if snaps:
            _sync_persist_snapshot(session_id, snaps[0], snaps[1])
        return

    existing = _PENDING_PERSIST_TIMERS.pop(session_id, None)
    if existing is not None:
        existing.cancel()

    if immediate:
        snaps = _capture_snapshots_on_loop(session_id)
        if snaps:
            loop.create_task(asyncio.to_thread(_sync_persist_snapshot, session_id, snaps[0], snaps[1]))
    else:
        def _schedule():
            _PENDING_PERSIST_TIMERS.pop(session_id, None)
            snaps = _capture_snapshots_on_loop(session_id)
            if snaps:
                loop.create_task(asyncio.to_thread(_sync_persist_snapshot, session_id, snaps[0], snaps[1]))
        _PENDING_PERSIST_TIMERS[session_id] = loop.call_later(0.6, _schedule)


def enqueue_dom_update(queue: list[str], text: str, max_items: int = 6, max_chars: int = 8000) -> list[str]:
    """Buffers non-blocking DOM/route updates in order without losing earlier handoffs."""
    cleaned = str(text or "").strip()
    if not cleaned:
        return queue
    if len(cleaned) > max_chars:
        cleaned = cleaned[-max_chars:]
    if cleaned in queue:
        queue.remove(cleaned)
    queue.append(cleaned)
    while len(queue) > max_items or (len(queue) > 1 and sum(len(item) for item in queue) > max_chars):
        queue.pop(0)
    return queue


def flush_dom_updates(queue: list[str]) -> str:
    """Drains and joins buffered silent DOM/route updates for the next Gemini turn."""
    if not queue:
        return ""
    combined = "\n\n".join(queue)
    queue.clear()
    return combined


def is_key_level_connect_error(err: Exception | str) -> bool:
    """Returns True when a connect error reflects quota/auth exhaustion rather than config incompatibility."""
    msg = str(err or "").lower()
    markers = ("401", "403", "429", "resource_exhausted", "quota", "api key", "api_key_invalid", "permission", "billing")
    return any(marker in msg for marker in markers)


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

    company_label = tenant.get("companyName") or "DeployMate"
    is_deploymate_brand = site_key in ("wo_live_deploymate_demo", "wo_live_deploymate_main", "wo_test_sandbox") or "deploymate" in company_label.lower()
    has_prior_turns = session_mem.get("reconnectCount", 0) > 0 and len(session_mem.get("transcripts") or []) > 0

    if has_prior_turns:
        welcome_rule = (
            f"- SESSION CONTINUITY & RESTORE MODE (CRITICAL): This is an active, restored session (reconnect #{session_mem.get('reconnectCount', 1)}). "
            f"DO NOT repeat your initial welcome greeting or re-introduce yourself! Wait for the user's speech or follow the latest page/navigation context seamlessly.\n"
        )
    elif is_deploymate_brand:
        welcome_rule = (
            f"- PROACTIVE WARM WELCOME ON START (CRITICAL): First-time visitors do NOT know how WebOrient works and will wait in silence. "
            f"The moment you connect, DO NOT wait for the user to say hello! Speak first immediately with a warm, friendly 1-2 sentence welcome "
            f"(introduce yourself as WebOrient on {company_label}, note that you can guide them with the Ghost Cursor, and suggest 1-2 things to explore like trying the live voice agent, WhatsApp CRM, or calculating ROI savings). Then pause and follow the user's lead!\n"
        )
    else:
        welcome_rule = (
            f"- PROACTIVE WARM WELCOME ON START (CRITICAL): First-time visitors do NOT know how WebOrient works and will wait in silence. "
            f"The moment you connect, DO NOT wait for the user to say hello! Speak first immediately with a warm, friendly 1-2 sentence welcome "
            f"(introduce yourself as the WebOrient co-pilot for {company_label}, mention you can guide them around the website with the Ghost Cursor, and offer to walk through the sections on screen). Then pause and follow the user's lead!\n"
        )

    memory_block = (
        f"\n\n### DEPLOYMATE MULTI-TENANT SESSION & LIVE CO-PILOT GUIDANCE "
        f"(Tenant: {company_label} | Session ID: {session_mem['sessionId']} | Credits: {tenant.get('creditsMinutes', 250)} mins):\n"
        f"{welcome_rule}"
        f"- DETECTED & LOCKED LANGUAGE: {session_mem['userLanguage']} (Maintain this language strictly across all turns, popups, and page redirects)\n"
        f"- SILENT SEAMLESS LANGUAGE HANDLING (CRITICAL): When speaking or when language changes, NEVER say aloud 'I will speak in English/Hindi' or announce what language you are using! Simply speak directly in that language without commenting on it or breaking the conversation flow.\n"
        f"- SHOWING vs. SAYING SYNCHRONIZATION RULE: Every single `explanation` badge you pass to `move_and_highlight`, `click_element`, `fill_form_field`, `scroll_page`, or `swipe_or_swap` MUST be written in the exact same language that you are speaking aloud! Never show an English tooltip badge while speaking Hindi/Hinglish!\n"
        f"- ZERO TO-DO OBSESSION — NO RUSHING (CRITICAL): The site sections and features are purely background reference for you so you can answer accurately. There is NO requirement to complete, visit, or check off every section! NEVER rush the user, NEVER mention remaining to-dos or checklists, and NEVER push unrequested sections onto the user. Patiently listen to the user, answer their questions, and follow their curiosity.\n"
        f"- TWO-LOCK FORM SUBMIT SAFETY: Never click a final Submit/Checkout button with `confirmed: true` unless the user has explicitly confirmed they want to submit.\n"
        f"- ONE TOOL PER SPOKEN TURN RULE (CRITICAL FOR ZERO-LAG AUDIO SYNC): Call at most ONE visual tool (`move_and_highlight` or `click_element` or `swipe_or_swap`) per turn and IMMEDIATELY speak aloud to the user while the Ghost Cursor moves to that element! NEVER chain 2 or 3 `move_and_highlight` calls in silence before speaking!\n"
        f"- FULL PAGE, POPUP, '/contact' SOUND GATE & CLOSE-BUTTON ('X') CONTROL: Every button, popup, modal, drawer, banner, input, 'Sound on' / 'Keep it silent' gate button, and Close ('X') button on the user's screen is indexed. If the user asks to click 'Sound on', 'Keep it silent', or close any popup/modal/drawer, immediately call `click_element` on its selector.\n"
        f"- USER GOAL / WANT: {session_mem['userGoal']} (Interested Plan: {session_mem['interestedTier']})\n"
        f"- CRITICAL VISUAL GROUNDING RULE: Go with the user in any order they want! Every single time you describe any DOM section, card, tab, carousel, calculator, popup, or input field, call `move_and_highlight`, `click_element`, `swipe_or_swap`, or `fill_form_field` on its actual interactive component selector (NEVER highlight h1/h2 titles or headers)."
    )

    recent_tx = session_mem.get("transcripts") or []
    if has_prior_turns and recent_tx:
        tx_lines = [f"  [{t.get('role', 'user').upper()}]: {t.get('text', '')}" for t in recent_tx[-10:] if t.get("text")]
        if tx_lines:
            memory_block += "\n\n### RESTORED CONVERSATION HISTORY (DO NOT REPEAT GREETING):\n" + "\n".join(tx_lines)

    latest_dom = str(session_mem.get("latestDomSnapshot") or "").strip()
    if latest_dom and session_mem.get("reconnectCount", 0) > 0:
        memory_block += f"\n\n### LATEST RESTORED PAGE DOM SNAPSHOT:\n{latest_dom[-3500:]}"

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
                            "confirmed": types.Schema(type=types.Type.BOOLEAN, description="Set to true ONLY when user has verbally confirmed a form submit action")
                        },
                        required=["selector"]
                    )
                ),
                types.FunctionDeclaration(
                    name="fill_form_field",
                    description="Fills or sets a form control (text, email, tel, date, textarea, select dropdown, combobox, checkbox, radio, or range slider) with typewriter animation and validation checking.",
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
                    description="Smoothly scrolls the page or active inner scrollable container up, down, to the top/bottom, or directly to a specific component.",
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
                    description="Navigates the website to another page route while preserving session memory.",
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
                    description="Updates cross-page session memory with what the user wants (goal, interested plan tier, or custom note).",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "goal": types.Schema(type=types.Type.STRING, description="What the user wants to achieve"),
                            "interestedTier": types.Schema(type=types.Type.STRING, description="Plan tier user is interested in"),
                            "language": types.Schema(type=types.Type.STRING, description="User's preferred language code"),
                            "todoIdDone": types.Schema(type=types.Type.STRING, description="ID or selector of section viewed"),
                            "note": types.Schema(type=types.Type.STRING, description="Additional preference or fact to remember across pages")
                        }
                    )
                )
            ]
        )
    ]


def build_http_response(status_code: int, payload: dict):
    body_bytes = json.dumps(payload, indent=2).encode("utf-8")
    headers_list = [
        ("Content-Type", "application/json; charset=utf-8"),
        ("Content-Length", str(len(body_bytes))),
        ("Access-Control-Allow-Origin", "*"),
        ("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS"),
        ("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-Token, X-Admin-Key")
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


def _scrub_tenant_public(tenant: dict) -> dict:
    """Omits tenant owner contact email from unauthenticated public responses."""
    return {k: v for k, v in tenant.items() if k != "email"}


async def process_http_request(*args):
    request_method = ""
    if len(args) == 2 and hasattr(args[1], "path"):
        request = args[1]
        raw_path = request.path
        headers = request.headers
        request_method = str(getattr(request, "method", "") or "").upper()
    else:
        raw_path = args[0]
        headers = args[1]

    upgrade = headers.get("Upgrade", "")
    if upgrade and upgrade.lower() == "websocket":
        return None

    if request_method == "OPTIONS":
        return build_http_response(200, {"ok": True})

    parsed = urlparse(raw_path)
    path = parsed.path.rstrip("/") or "/"
    qs = parse_qs(parsed.query)
    admin_ok = is_admin_request(headers, qs)

    if path in ("/health", "/ping", "/healthz", "/"):
        now_utc = datetime.datetime.now(datetime.timezone.utc)
        uptime_seconds = int((now_utc - SERVER_START_TIME).total_seconds())
        keys_list = KEY_POOL.list_public_keys()
        payload = {
            "status": "ok",
            "service": "weborient-relay",
            "model": MODEL_NAME,
            "mongoConnected": mongo_db is not None,
            "tenantCount": len(TENANT_STORE),
            "apiKeyPoolCount": len(keys_list),
            "uptimeSeconds": uptime_seconds,
            "timestamp": now_utc.isoformat()
        }
        if admin_ok:
            payload["apiKeyPool"] = keys_list
        return build_http_response(200, payload)

    if path == "/api/tenants":
        if admin_ok:
            return build_http_response(200, {"ok": True, "tenants": list_all_tenants()})
        site_key = qs.get("siteKey", [""])[0].strip()
        if not site_key:
            return build_http_response(401, {"ok": False, "error": "Unauthorized"})
        tenant = get_tenant(site_key)
        if not tenant:
            return build_http_response(404, {"ok": False, "error": f"Tenant '{site_key}' not found"})
        return build_http_response(200, {"ok": True, "tenants": [_scrub_tenant_public(tenant)]})

    if path == "/api/sessions":
        if not admin_ok:
            return build_http_response(401, {"ok": False, "error": "Unauthorized"})
        site_key = qs.get("siteKey", [""])[0]
        try:
            limit = max(1, min(int(qs.get("limit", ["50"])[0]), 200))
        except ValueError:
            return build_http_response(400, {"ok": False, "error": "Invalid limit parameter"})
        return build_http_response(200, {"ok": True, "sessions": list_recent_sessions(site_key, limit)})

    if path == "/api/keys":
        if not admin_ok:
            return build_http_response(401, {"ok": False, "error": "Unauthorized"})
        return build_http_response(200, {"ok": True, "keys": KEY_POOL.list_public_keys()})

    if path == "/api/tenants/status":
        site_key = qs.get("siteKey", ["wo_live_deploymate_demo"])[0]
        tenant = get_tenant(site_key)
        if not tenant:
            return build_http_response(404, {"ok": False, "error": f"Tenant '{site_key}' not found"})
        safe_tenant = tenant if admin_ok else _scrub_tenant_public(tenant)
        return build_http_response(200, {"ok": True, "tenant": safe_tenant})

    if path == "/api/tenants/register":
        company = qs.get("companyName", ["My Store"])[0]
        domain = qs.get("domain", ["localhost"])[0]
        email = qs.get("email", [""])[0]
        plan = qs.get("plan", ["Starter ($29/mo)"])[0]
        theme = qs.get("theme", ["signal"])[0]
        lang = qs.get("lang", ["en-IN"])[0]
        if not lang or lang == "undefined":
            lang = "en-IN"
        try:
            credits = float(qs.get("credits", ["25.0"])[0])
        except ValueError:
            return build_http_response(400, {"ok": False, "error": "Invalid credits parameter"})
        tenant_doc = register_new_tenant(company, domain, email, plan, theme, lang, credits)
        return build_http_response(201, {"ok": True, "tenant": tenant_doc})

    if path == "/api/tenants/credits":
        site_key = qs.get("siteKey", ["wo_live_deploymate_demo"])[0]
        is_demo_topup = bool(qs.get("demoTopup", [""])[0]) and site_key == "wo_live_deploymate_demo"
        if not admin_ok and not is_demo_topup:
            return build_http_response(401, {"ok": False, "error": "Unauthorized credit top-up request"})
        try:
            minutes = float(qs.get("minutes", ["150.0"])[0])
        except ValueError:
            return build_http_response(400, {"ok": False, "error": "Invalid minutes parameter"})
        if not admin_ok and (minutes <= 0 or minutes > 500):
            return build_http_response(400, {"ok": False, "error": "Demo top-up must be between 1 and 500 minutes"})
        updated = add_tenant_credits(site_key, minutes)
        if not updated:
            return build_http_response(404, {"ok": False, "error": f"Tenant '{site_key}' not found"})
        safe_updated = updated if admin_ok else _scrub_tenant_public(updated)
        return build_http_response(200, {"ok": True, "tenant": safe_updated})

    return None


def build_live_connect_config(
    full_prompt: str,
    tools: list,
    resumption_handle: str | None = None,
    minimal: bool = False
) -> types.LiveConnectConfig:
    speech_config = types.SpeechConfig(
        voice_config=types.VoiceConfig(
            prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=VOICE_NAME)
        )
    )
    cfg_kwargs = {
        "response_modalities": [types.Modality.AUDIO],
        "speech_config": speech_config,
        "input_audio_transcription": types.AudioTranscriptionConfig(),
        "output_audio_transcription": types.AudioTranscriptionConfig(),
        "system_instruction": types.Content(parts=[types.Part.from_text(text=full_prompt)]),
        "tools": tools
    }
    if not minimal:
        # Enable ContextWindowCompressionConfig and SessionResumptionConfig (without Vertex-only transparent flag)
        if hasattr(types, "ContextWindowCompressionConfig") and hasattr(types, "SlidingWindow"):
            try:
                cfg_kwargs["context_window_compression"] = types.ContextWindowCompressionConfig(
                    trigger_tokens=12000,
                    sliding_window=types.SlidingWindow(target_tokens=8000)
                )
            except Exception:
                pass
        if hasattr(types, "SessionResumptionConfig"):
            try:
                resumption_kwargs: dict = {}
                if resumption_handle:
                    resumption_kwargs["handle"] = resumption_handle
                cfg_kwargs["session_resumption"] = types.SessionResumptionConfig(**resumption_kwargs)
            except Exception:
                pass
    return types.LiveConnectConfig(**cfg_kwargs)


async def handle_browser_client(websocket):
    raw_path = getattr(websocket, "path", "") or (websocket.request.path if hasattr(websocket, "request") and websocket.request else "/")
    parsed_url = urlparse(raw_path)
    qs = parse_qs(parsed_url.query)
    ws_headers = getattr(getattr(websocket, "request", None), "headers", None) or getattr(websocket, "request_headers", None)

    # Portal & Admin RPC mode (`wss://relay.deploymate.in/?mode=portal`)
    mode = qs.get("mode", [""])[0]
    if mode == "portal":
        try:
            async for raw_msg in websocket:
                req = json.loads(raw_msg)
                action = req.get("tenantAction")
                req_token = str(req.get("adminToken") or req.get("adminKey") or "")
                portal_admin = is_admin_request(ws_headers, qs, extra_token=req_token)

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
                    target_key = req.get("siteKey", "wo_live_deploymate_demo")
                    mins = float(req.get("minutes", 150.0))
                    is_demo_topup = bool(req.get("demoTopup")) and target_key == "wo_live_deploymate_demo" and 0 < mins <= 500
                    if not portal_admin and not is_demo_topup:
                        await websocket.send(json.dumps({"ok": False, "action": "addCredits", "error": "Unauthorized"}))
                        continue
                    doc = add_tenant_credits(
                        target_key,
                        mins,
                        req.get("plan") if portal_admin else None
                    )
                    safe_doc = doc if (not doc or portal_admin) else _scrub_tenant_public(doc)
                    await websocket.send(json.dumps({"ok": bool(doc), "action": "addCredits", "tenant": safe_doc}))
                elif action == "list":
                    tenants_out = list_all_tenants()
                    if portal_admin:
                        await websocket.send(json.dumps({
                            "ok": True,
                            "action": "list",
                            "tenants": tenants_out,
                            "sessions": list_recent_sessions(req.get("siteKey", ""), max(1, min(int(req.get("limit", 40)), 200))),
                            "keys": KEY_POOL.list_public_keys()
                        }))
                    else:
                        await websocket.send(json.dumps({
                            "ok": True,
                            "action": "list",
                            "tenants": [_scrub_tenant_public(t) for t in tenants_out],
                            "sessions": [],
                            "keys": []
                        }))
                elif action in ("listSessions", "listKeys", "addKey", "updateKey", "deleteKey"):
                    if not portal_admin:
                        await websocket.send(json.dumps({"ok": False, "action": action, "error": "Unauthorized: admin token required"}))
                        continue
                    if action == "listSessions":
                        limit_val = max(1, min(int(req.get("limit", 50)), 200))
                        await websocket.send(json.dumps({
                            "ok": True,
                            "action": "listSessions",
                            "sessions": list_recent_sessions(req.get("siteKey", ""), limit_val)
                        }))
                    elif action == "listKeys":
                        await websocket.send(json.dumps({"ok": True, "action": "listKeys", "keys": KEY_POOL.list_public_keys()}))
                    elif action == "addKey":
                        kdoc = KEY_POOL.add_key(req.get("label", "Gemini Live Key"), req.get("apiKey", ""), int(req.get("priority", 1)))
                        await websocket.send(json.dumps({"ok": True, "action": "addKey", "key": kdoc, "keys": KEY_POOL.list_public_keys()}))
                    elif action == "updateKey":
                        kdoc = KEY_POOL.update_key(req.get("keyId", ""), req.get("label"), req.get("status"), req.get("priority"))
                        await websocket.send(json.dumps({"ok": bool(kdoc), "action": "updateKey", "keys": KEY_POOL.list_public_keys()}))
                    elif action == "deleteKey":
                        deleted = KEY_POOL.delete_key(req.get("keyId", ""))
                        await websocket.send(json.dumps({"ok": deleted, "action": "deleteKey", "keys": KEY_POOL.list_public_keys()}))
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
    remote_ip = "local"
    if hasattr(websocket, "request") and websocket.request and hasattr(websocket.request, "headers"):
        origin_header = websocket.request.headers.get("Origin", "")
        remote_ip = websocket.request.headers.get("X-Forwarded-For", "").split(",")[0].strip() or remote_ip
    elif hasattr(websocket, "request_headers"):
        origin_header = websocket.request_headers.get("Origin", "")
        remote_ip = websocket.request_headers.get("X-Forwarded-For", "").split(",")[0].strip() or remote_ip

    ip_ok, ip_token_or_err = check_ip_rate_limit(remote_ip)
    if not ip_ok:
        await websocket.send(json.dumps({"error": ip_token_or_err, "code": "RATE_LIMIT_EXCEEDED"}))
        await websocket.close(code=4003, reason=ip_token_or_err[:120])
        return

    authorized, auth_msg, tenant = verify_tenant_and_origin(site_key, origin_header)
    if not authorized:
        release_ip_slot(ip_token_or_err)
        print(f"[RELAY] ❌ Rejected connection: {auth_msg}")
        await websocket.send(json.dumps({"error": auth_msg, "code": "UNAUTHORIZED_OR_NO_CREDITS"}))
        await websocket.close(code=4002, reason=auth_msg[:120])
        return

    # Optional pre-connect clientInit frame (sent immediately on ws.onopen) so page restore / navigation
    # updates latestDomSnapshot and userLanguage BEFORE build_live_connect_config constructs system_instruction!
    # Wait before creating/persisting session memory so aborted <0.22s handshakes don't save empty records.
    buffered_first_raw_msg = None
    client_init_lang = None
    client_init_snapshot = None
    try:
        first_raw = await asyncio.wait_for(websocket.recv(), timeout=0.22)
        first_data = json.loads(first_raw)
        if isinstance(first_data, dict) and "clientInit" in first_data:
            ci = first_data["clientInit"] or {}
            if ci.get("userLanguage"):
                client_init_lang = str(ci["userLanguage"]).strip()
            if ci.get("latestDomSnapshot"):
                client_init_snapshot = str(ci["latestDomSnapshot"]).strip()[-3500:]
        else:
            buffered_first_raw_msg = first_raw
    except asyncio.TimeoutError:
        pass
    except websockets.exceptions.ConnectionClosed:
        release_ip_slot(ip_token_or_err)
        return
    except Exception:
        pass

    session_mem = get_or_create_session_memory(
        session_id,
        site_key,
        site_id,
        client_init_lang or lang,
        tenant.get("companyName", "")
    )
    if client_init_snapshot is not None:
        session_mem["latestDomSnapshot"] = client_init_snapshot
        persist_session_memory(session_id)

    full_prompt = load_system_prompt_and_manifest(site_id, session_mem, tenant)
    tools = get_gemini_tools()
    resumption_handle = session_mem.get("resumptionHandle") or None

    # Multi-Key Load Balancer & Zero-Downtime Failover Loop
    candidates = KEY_POOL.get_ordered_candidate_keys()
    last_connect_err = None

    try:
        for key_doc in candidates[:3]:
            selected_key_id = key_doc["keyId"]
            selected_api_key = key_doc["apiKey"]
            selected_label = key_doc.get("label", selected_key_id)
            connected_once = False
            session_completed = False

            try:
                client = genai.Client(api_key=selected_api_key, http_options={"api_version": "v1alpha"})
                # Try: (1) with resumption handle if present, (2) fresh full config, (3) minimal guaranteed config
                attempt_plan = (
                    [(resumption_handle, False), (None, False), (None, True)]
                    if resumption_handle
                    else [(None, False), (None, True)]
                )
                for attempt_idx, (attempt_handle, is_minimal) in enumerate(attempt_plan):
                    if attempt_idx > 0:
                        if connected_once:
                            break
                        if attempt_handle is None and session_mem.get("resumptionHandle"):
                            session_mem["resumptionHandle"] = None
                            resumption_handle = None
                            persist_session_memory(session_id)
                        print(f"[RELAY] 🔄 Retrying Live connect (minimal={is_minimal}, handle={bool(attempt_handle)})...")
                    config = build_live_connect_config(
                        full_prompt,
                        tools,
                        resumption_handle=attempt_handle,
                        minimal=is_minimal
                    )
                    try:
                        async with client.aio.live.connect(model=MODEL_NAME, config=config) as gemini_session:
                            connected_once = True
                            KEY_POOL.mark_session_started(selected_key_id)
                            session_mem["apiKeyId"] = selected_key_id
                            session_mem["apiKeyLabel"] = f"{selected_label} ({key_doc.get('maskedKey')})"
                            persist_session_memory(session_id)

                            print(
                                f"[RELAY] ✅ Active session | tenant={tenant.get('companyName')} ({site_key}) | "
                                f"key={selected_label} | voice={VOICE_NAME} (Kavya) | credits={tenant.get('creditsMinutes')}m | sessionId={session_id}"
                            )
                            try:
                                await websocket.send(json.dumps({
                                    "setupComplete": {
                                        "status": "ready",
                                        "sessionId": session_id,
                                        "voice": VOICE_NAME,
                                        "resumedWithHandle": bool(attempt_handle)
                                    }
                                }))
                            except Exception:
                                pass

                            is_secretary_hold = False
                            session_minutes_burned = 0.0
                            last_saved_sec_reported = int(session_mem.get("secretarySavedSeconds", 0))
                            pending_dom_updates: list[str] = []

                            async def credit_metering_loop():
                                """Meters active voice co-browsing credits every 30s; pauses when Local Secretary holds stream."""
                                nonlocal session_minutes_burned, last_saved_sec_reported
                                try:
                                    while True:
                                        await asyncio.sleep(30)
                                        current_saved = int(session_mem.get("secretarySavedSeconds", 0))
                                        saved_delta = max(0, current_saved - last_saved_sec_reported)
                                        last_saved_sec_reported = current_saved

                                        if is_secretary_hold:
                                            # Zero credit deduction while visitor is silently reading in Secretary Hold!
                                            if saved_delta > 0:
                                                await asyncio.to_thread(deduct_tenant_credits, site_key, 0.0, saved_delta)
                                            tenant_doc = await asyncio.to_thread(get_tenant, site_key)
                                            await websocket.send(json.dumps({
                                                "creditUpdate": {
                                                    "siteKey": site_key,
                                                    "remainingMinutes": (tenant_doc or {}).get("creditsMinutes", 0.0),
                                                    "secretaryHold": True,
                                                    "secretarySavedSeconds": current_saved
                                                }
                                            }))
                                            continue

                                        remaining = await asyncio.to_thread(deduct_tenant_credits, site_key, 0.5, saved_delta)
                                        session_minutes_burned = round(session_minutes_burned + 0.5, 2)
                                        session_mem["creditsBurned"] = round(float(session_mem.get("creditsBurned", 0.0)) + 0.5, 2)
                                        persist_session_memory(session_id)

                                        print(f"[RELAY] ⏱️ Credit tick for {site_key}: {remaining} mins remaining (Secretary saved: {current_saved}s)")
                                        await websocket.send(json.dumps({
                                            "creditUpdate": {
                                                "siteKey": site_key,
                                                "remainingMinutes": remaining,
                                                "secretaryHold": False,
                                                "secretarySavedSeconds": current_saved
                                            }
                                        }))
                                        if remaining <= 0:
                                            session_mem["terminationReason"] = "credits_exhausted"
                                            persist_session_memory(session_id, immediate=True)
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
                                            resumption_update = getattr(response, "session_resumption_update", None)
                                            if (
                                                resumption_update
                                                and getattr(resumption_update, "resumable", False)
                                                and getattr(resumption_update, "new_handle", None)
                                            ):
                                                session_mem["resumptionHandle"] = resumption_update.new_handle
                                                persist_session_memory(session_id)

                                            sc = response.server_content
                                            if sc:
                                                if getattr(sc, "interrupted", False):
                                                    await websocket.send(json.dumps({
                                                        "serverContent": {"interrupted": True}
                                                    }))

                                                if getattr(sc, "input_transcription", None) and getattr(sc.input_transcription, "text", None):
                                                    raw_utext = sc.input_transcription.text
                                                    clean_utext = redact_sensitive_text(raw_utext)
                                                    print(f"[RELAY] 🗣️ User said: {clean_utext}")
                                                    session_mem.setdefault("transcripts", []).append({
                                                        "role": "user",
                                                        "text": clean_utext,
                                                        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat()
                                                    })
                                                    session_mem["transcripts"] = session_mem["transcripts"][-40:]
                                                    persist_session_memory(session_id)
                                                    await websocket.send(json.dumps({
                                                        "serverContent": {
                                                            "inputTranscription": {"text": raw_utext}
                                                        }
                                                    }))

                                                if getattr(sc, "output_transcription", None) and getattr(sc.output_transcription, "text", None):
                                                    raw_mtext = sc.output_transcription.text
                                                    clean_mtext = redact_sensitive_text(raw_mtext)
                                                    print(f"[RELAY] 🤖 Kavya ({VOICE_NAME}): {clean_mtext}")
                                                    session_mem.setdefault("transcripts", []).append({
                                                        "role": "model",
                                                        "text": clean_mtext,
                                                        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat()
                                                    })
                                                    session_mem["transcripts"] = session_mem["transcripts"][-40:]
                                                    persist_session_memory(session_id)
                                                    await websocket.send(json.dumps({
                                                        "serverContent": {
                                                            "outputTranscription": {"text": raw_mtext}
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

                                            if getattr(response, "tool_call_cancellation", None):
                                                cancel_ids = list(getattr(response.tool_call_cancellation, "ids", None) or [])
                                                if cancel_ids:
                                                    print(f"[RELAY] ⚠️ Tool call cancellation from Gemini: {cancel_ids}")
                                                    await websocket.send(json.dumps({
                                                        "toolCallCancellation": {"ids": cancel_ids}
                                                    }))

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

                                            if sc and getattr(sc, "turn_complete", False):
                                                await websocket.send(json.dumps({
                                                    "serverContent": {"turnComplete": True}
                                                }))
                                                break
                                        await asyncio.sleep(0.02)
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
                                nonlocal is_secretary_hold, pending_dom_updates, buffered_first_raw_msg
                                audio_count = 0

                                async def _process_client_raw_msg(raw_msg: str) -> bool:
                                    nonlocal is_secretary_hold, pending_dom_updates, audio_count
                                    data = json.loads(raw_msg)

                                    if "ping" in data:
                                        await websocket.send(json.dumps({"pong": data["ping"]}))
                                        return True

                                    if "clientInit" in data:
                                        ci = data["clientInit"] or {}
                                        if ci.get("userLanguage"):
                                            session_mem["userLanguage"] = str(ci["userLanguage"]).strip()
                                        if ci.get("latestDomSnapshot"):
                                            session_mem["latestDomSnapshot"] = str(ci["latestDomSnapshot"]).strip()[-3500:]
                                        persist_session_memory(session_id)
                                        return True

                                    if "vadControl" in data:
                                        vc = data["vadControl"] or {}
                                        vstate = vc.get("state")
                                        saved_sec = int(vc.get("savedSeconds", session_mem.get("secretarySavedSeconds", 0)))
                                        session_mem["secretarySavedSeconds"] = saved_sec
                                        if vstate == "secretary_hold":
                                            is_secretary_hold = True
                                            print(f"[RELAY] ⏸️ Secretary Hold engaged for {session_id} (0 tokens/sec, credit meter paused)")
                                            try:
                                                await gemini_session.send_realtime_input(audio_stream_end=True)
                                            except Exception:
                                                pass
                                        elif vstate == "active":
                                            is_secretary_hold = False
                                            print(f"[RELAY] ▶️ Secretary woke session {session_id} (<15ms pre-roll flush)")
                                        elif vstate == "hibernating":
                                            is_secretary_hold = True
                                            session_mem["status"] = "hibernating"
                                            session_mem["terminationReason"] = vc.get("reason", "idle_75s")
                                            persist_session_memory(session_id, immediate=True)
                                            print(f"[RELAY] 💤 Session {session_id} entered Deep Hibernation ({vc.get('reason')})")
                                            return False
                                        elif vstate == "navigating":
                                            is_secretary_hold = True
                                            session_mem["status"] = "navigating"
                                            persist_session_memory(session_id, immediate=True)
                                            print(f"[RELAY] 🧭 Session {session_id} navigating to new route; releasing upstream session cleanly")
                                            return False
                                        return True

                                    if "telemetry" in data:
                                        tel = data.get("telemetry") or {}
                                        if isinstance(tel, dict):
                                            if tel.get("userLanguage"):
                                                session_mem["userLanguage"] = str(tel["userLanguage"]).strip()
                                            if isinstance(tel.get("domEventLogs"), list):
                                                session_mem["domEvents"] = tel["domEventLogs"][-40:]
                                                session_mem["failedSelectorsCount"] = sum(
                                                    1 for ev in session_mem["domEvents"] if not ev.get("success", True)
                                                )
                                            if isinstance(tel.get("partialLead"), dict):
                                                existing_lead = dict(session_mem.get("partialLead") or {})
                                                existing_lead.update(tel["partialLead"])
                                                session_mem["partialLead"] = existing_lead
                                                if existing_lead.get("submitted"):
                                                    session_mem["terminationReason"] = "converted"
                                            if tel.get("lastSectionViewed"):
                                                session_mem["lastSectionViewed"] = tel["lastSectionViewed"]
                                            if "secretarySavedSeconds" in tel:
                                                session_mem["secretarySavedSeconds"] = int(tel["secretarySavedSeconds"] or 0)
                                            persist_session_memory(session_id)
                                        return True

                                    if "realtimeInput" in data:
                                        is_secretary_hold = False
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
                                        return True

                                    if "toolResponse" in data:
                                        responses = data["toolResponse"].get("functionResponses", [])
                                        fn_responses = []
                                        for r in responses:
                                            raw_resp = r.get("response") or {}
                                            out = raw_resp.get("output") or {}
                                            digest = out.get("sessionMemoryDigest")
                                            if digest:
                                                session_mem["userLanguage"] = digest.get("userLanguage", session_mem["userLanguage"])
                                                session_mem["userGoal"] = digest.get("userGoal", session_mem["userGoal"])
                                                session_mem["interestedTier"] = digest.get("interestedTier", session_mem.get("interestedTier"))
                                                session_mem["completedTodoIds"] = digest.get("completedTodoIds", session_mem.get("completedTodoIds", []))
                                                session_mem["remainingTodos"] = digest.get("remainingTodos", session_mem.get("remainingTodos", []))
                                                session_mem["lastSectionViewed"] = digest.get("lastSectionViewed") or session_mem.get("lastSectionViewed")
                                                session_mem["secretarySavedSeconds"] = int(digest.get("secretarySavedSeconds") or session_mem.get("secretarySavedSeconds", 0))
                                                if digest.get("domEventLogs"):
                                                    session_mem["domEvents"] = digest["domEventLogs"]
                                                    session_mem["failedSelectorsCount"] = sum(
                                                        1 for ev in session_mem["domEvents"] if not ev.get("success", True)
                                                    )
                                                if digest.get("partialLead"):
                                                    session_mem["partialLead"] = digest["partialLead"]
                                                    if session_mem["partialLead"].get("submitted"):
                                                        session_mem["terminationReason"] = "converted"
                                            if out.get("selector"):
                                                session_mem["orientedHistory"].append(out.get("selector"))
                                            persist_session_memory(session_id)

                                            # Strip heavy telemetry fields before sending response back to Gemini context
                                            sanitized_response = dict(raw_resp)
                                            if isinstance(out, dict):
                                                sanitized_out = dict(out)
                                                if isinstance(digest, dict):
                                                    sanitized_digest = {
                                                        k: v for k, v in digest.items()
                                                        if k not in ("domEventLogs", "partialLead")
                                                    }
                                                    sanitized_out["sessionMemoryDigest"] = sanitized_digest
                                                dom_batch = flush_dom_updates(pending_dom_updates)
                                                if dom_batch:
                                                    sanitized_out["latestDomContext"] = dom_batch
                                                sanitized_response["output"] = sanitized_out

                                            fn_responses.append(
                                                types.FunctionResponse(
                                                    id=r["id"],
                                                    name=r.get("name", "move_and_highlight"),
                                                    response=sanitized_response
                                                )
                                            )
                                        await gemini_session.send_tool_response(function_responses=fn_responses)
                                        return True

                                    if "text" in data:
                                        turn_complete = bool(data.get("turnComplete", True))
                                        text_str = str(data["text"]).strip()
                                        if not text_str:
                                            return True
                                        if data.get("userLanguage"):
                                            session_mem["userLanguage"] = str(data["userLanguage"]).strip()
                                        # Only update latestDomSnapshot when the message carries DOM/section index data
                                        if any(marker in text_str for marker in ("DOM INDEX", "CURRENT PAGE SECTIONS", "Visible Interactive Controls")):
                                            session_mem["latestDomSnapshot"] = text_str[-3500:]
                                        persist_session_memory(session_id)
                                        if turn_complete:
                                            is_secretary_hold = False
                                            dom_batch = flush_dom_updates(pending_dom_updates)
                                            text_payload = f"{dom_batch}\n\n{text_str}" if dom_batch else text_str
                                            await gemini_session.send_realtime_input(text=text_payload)
                                        else:
                                            enqueue_dom_update(pending_dom_updates, text_str)
                                        return True

                                    return True

                                try:
                                    if buffered_first_raw_msg is not None:
                                        first_to_run = buffered_first_raw_msg
                                        buffered_first_raw_msg = None
                                        should_continue = await _process_client_raw_msg(first_to_run)
                                        if not should_continue:
                                            return

                                    async for raw_msg in websocket:
                                        try:
                                            should_continue = await _process_client_raw_msg(raw_msg)
                                            if not should_continue:
                                                break
                                        except websockets.exceptions.ConnectionClosed:
                                            break
                                        except Exception as err:
                                            print(f"[RELAY] Error processing client message: {err}")
                                except websockets.exceptions.ConnectionClosed:
                                    pass

                            meter_task = asyncio.create_task(credit_metering_loop())
                            g2b_task = asyncio.create_task(forward_gemini_to_browser())
                            b2g_task = asyncio.create_task(forward_browser_to_gemini())
                            try:
                                done, pending = await asyncio.wait(
                                    [g2b_task, b2g_task],
                                    return_when=asyncio.FIRST_COMPLETED
                                )
                                for p_task in pending:
                                    p_task.cancel()
                                if pending:
                                    await asyncio.gather(*pending, return_exceptions=True)
                            finally:
                                meter_task.cancel()
                                await asyncio.gather(meter_task, return_exceptions=True)
                                KEY_POOL.mark_session_ended(selected_key_id, session_minutes_burned)
                                if session_mem.get("status") == "active":
                                    session_mem["status"] = "completed"
                                if not session_mem.get("terminationReason"):
                                    session_mem["terminationReason"] = "converted" if session_mem.get("partialLead", {}).get("submitted") else "user_closed"
                                await _flush_session_memory_async(session_id)
                            session_completed = True
                            break
                    except Exception as inner_err:
                        if is_key_level_connect_error(inner_err):
                            print(f"[RELAY] ⚠️ Key-level connect failure ({inner_err}); failing over immediately to next key...")
                            raise
                        if not connected_once and attempt_idx < len(attempt_plan) - 1:
                            print(f"[RELAY] ⚠️ Connect attempt {attempt_idx + 1} failed ({inner_err}); trying fallback config...")
                            continue
                        raise

                if session_completed:
                    # Session completed normally; break out of failover loop
                    break

            except Exception as conn_err:
                last_connect_err = conn_err
                KEY_POOL.mark_key_error(selected_key_id, str(conn_err), cooldown_sec=60)
                print(f"[RELAY] 🔄 Failover: Key {selected_label} failed ({conn_err}); trying next key in pool...")
                continue
        else:
            # All candidate keys failed
            err_str = f"All Gemini API keys in pool failed. Last error: {last_connect_err}"
            print(f"[RELAY] ❌ {err_str}")
            await websocket.send(json.dumps({"error": err_str, "code": "UPSTREAM_POOL_EXHAUSTED"}))
    except websockets.exceptions.ConnectionClosed:
        print(f"[RELAY] Client {session_id} disconnected (session persisted).")
    finally:
        release_ip_slot(ip_token_or_err)


async def main():
    print("=================================================================")
    print(" WebOrient by DeployMate — Multi-Tenant Relay Gateway (v1.0.0)")
    print(f" Target Model : {MODEL_NAME} (Voice: {VOICE_NAME} / Kavya Persona)")
    print(f" API Key Pool : {len(KEY_POOL.list_public_keys())} key(s) loaded in load balancer")
    print(f" Storage Mode : {'MongoDB Atlas (deploymate)' if mongo_db is not None else 'Local JSON (config/tenants.json)'}")
    print(f" WebSocket URI: ws://localhost:{PORT}?siteKey=wo_live_deploymate_demo")
    print(f" HTTP Health  : http://localhost:{PORT}/health")
    print("=================================================================")
    async with websockets.serve(
        handle_browser_client,
        "0.0.0.0",
        PORT,
        process_request=process_http_request,
        ping_interval=20,
        ping_timeout=20,
        max_size=10 * 1024 * 1024
    ):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
