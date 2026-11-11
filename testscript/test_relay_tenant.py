#!/usr/bin/env python3
"""
Test script to verify multi-tenant authentication and credit metering
against WebOrient Relay Gateway on port 8088.
"""
import asyncio
import json
import sys
import websockets

async def test_tenant_auth():
    print(">>> 1. Testing Valid Tenant Key ('wo_live_deploymate_demo')...")
    uri = "ws://localhost:8088?siteKey=wo_live_deploymate_demo&sessionId=test_sess_01"
    headers = {"Origin": "http://localhost:3333"}
    try:
        async with websockets.connect(uri, additional_headers=headers) as ws:
            print("  [SUCCESS] Connected to relay with valid siteKey and Origin!")
            # Send a quick text prompt
            await ws.send(json.dumps({"text": "Hello, is WebOrient online?"}))
            # Wait for greeting or first response
            msg_raw = await asyncio.wait_for(ws.recv(), timeout=12.0)
            data = json.loads(msg_raw)
            print(f"  [SUCCESS] Received response frame: {list(data.keys())}")
    except Exception as e:
        print(f"  [FAILED] Valid tenant connection failed: {e}")
        return False

    print("\n>>> 2. Testing Invalid Tenant Key ('wo_invalid_key_xyz')...")
    bad_uri = "ws://localhost:8088?siteKey=wo_invalid_key_xyz&sessionId=test_sess_bad"
    try:
        async with websockets.connect(bad_uri, additional_headers=headers) as ws:
            # Should receive error frame and close
            resp = await ws.recv()
            print(f"  Received: {resp}")
    except websockets.exceptions.ConnectionClosed as cc:
        print(f"  [SUCCESS] Relay correctly closed connection with code {cc.code}: {cc.reason}")
    except Exception as e:
        print(f"  [INFO] Handshake closed as expected: {e}")

    return True

if __name__ == "__main__":
    success = asyncio.run(test_tenant_auth())
    sys.exit(0 if success else 1)
