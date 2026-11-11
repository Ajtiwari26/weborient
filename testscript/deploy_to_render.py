#!/usr/bin/env python3
"""
Automated deployment script for WebOrient Relay to Render via Render REST API.
"""
import os
import sys
import json
import urllib.request
import urllib.error
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEPLOYMATE_ROOT = PROJECT_ROOT.parent / "DeployMate"

# 1. Load keys from .env files
gemini_key = None
weborient_env = PROJECT_ROOT / ".env"
if weborient_env.exists():
    for line in weborient_env.read_text().splitlines():
        line = line.strip()
        if line.startswith("GEMINI_LIVE_API_KEY="):
            gemini_key = line.split("=", 1)[1].strip().strip('"').strip("'")

mongo_uri = None
deploymate_env = DEPLOYMATE_ROOT / ".env"
if deploymate_env.exists():
    for line in deploymate_env.read_text().splitlines():
        line = line.strip()
        if line.startswith("MONGODB_URI="):
            mongo_uri = line.split("=", 1)[1].strip().strip('"').strip("'")

if not gemini_key:
    print("[-] Missing GEMINI_LIVE_API_KEY")
    sys.exit(1)

if not mongo_uri:
    print("[-] Missing MONGODB_URI")
    sys.exit(1)

# Render API credentials
RENDER_TOKEN = "rnd_SQ0VnrnuHg4hvIuBDvINzTyXTivm"
OWNER_ID = "tea-d7mfe4qqqhas73fbca80"

headers = {
    "Authorization": f"Bearer {RENDER_TOKEN}",
    "Content-Type": "application/json",
    "Accept": "application/json"
}

payload = {
    "type": "web_service",
    "name": "weborient-relay",
    "ownerId": OWNER_ID,
    "repo": "https://github.com/Ajtiwari26/weborient",
    "autoDeploy": "yes",
    "branch": "main",
    "serviceDetails": {
        "env": "python",
        "plan": "free",
        "region": "singapore",
        "envSpecificDetails": {
            "buildCommand": "pip install -r requirements.txt",
            "startCommand": "python3 src/relay/weborient_relay.py"
        },
        "healthCheckPath": "/health",
        "envVars": [
            {"key": "GEMINI_MODEL", "value": "gemini-3.8-live"},
            {"key": "GEMINI_LIVE_API_KEY", "value": gemini_key},
            {"key": "MONGODB_URI", "value": mongo_uri}
        ]
    }
}

req = urllib.request.Request(
    "https://api.render.com/v1/services",
    data=json.dumps(payload).encode("utf-8"),
    headers=headers,
    method="POST"
)

try:
    with urllib.request.urlopen(req) as resp:
        res_data = json.loads(resp.read().decode("utf-8"))
        print("[+] Service created successfully on Render!")
        print(json.dumps(res_data, indent=2))
except urllib.error.HTTPError as e:
    err_body = e.read().decode("utf-8")
    print(f"[-] Render API error ({e.code}): {err_body}")
    sys.exit(1)
