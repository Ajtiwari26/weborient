#!/usr/bin/env python3
"""
WebOrient Keep-Alive Ping Test Script
Tests both https://relay.deploymate.in/ping and https://weborient-relay.onrender.com/ping
"""
import urllib.request
import json
import time

ENDPOINTS = [
    "https://relay.deploymate.in/ping",
    "https://weborient-relay.onrender.com/ping",
    "https://relay.deploymate.in/health",
    "https://weborient-relay.onrender.com/"
]

def ping_url(url: str):
    start = time.time()
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "WebOrient-KeepAlive/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            elapsed = int((time.time() - start) * 1000)
            data = resp.read().decode("utf-8")
            try:
                parsed = json.loads(data)
                print(f"✓ [{resp.status}] {url} ({elapsed}ms) - uptime: {parsed.get('uptimeSeconds', 'N/A')}s, mongo: {parsed.get('mongoConnected')}")
            except Exception:
                print(f"✓ [{resp.status}] {url} ({elapsed}ms) - body: {data[:60]}")
    except Exception as e:
        elapsed = int((time.time() - start) * 1000)
        print(f"✗ [FAIL] {url} ({elapsed}ms) - {e}")

if __name__ == "__main__":
    print("Testing WebOrient Keep-Alive Ping Endpoints...")
    for u in ENDPOINTS:
        ping_url(u)
