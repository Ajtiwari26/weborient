#!/usr/bin/env python3
"""
WebOrient Live Relay Server
Bridges browser clients (via WebSocket) with the Gemini 3.8 Live API,
forwarding real-time audio streams, handling barge-in interruptions,
and dispatching DOM tool calls to the on-screen Ghost Cursor.
"""
import asyncio
import json
import os
import sys
from pathlib import Path

# Load environment credentials
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
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


def load_system_prompt_and_manifest():
    prompt_file = PROJECT_ROOT / "config" / "agent-prompt.md"
    manifest_file = PROJECT_ROOT / "config" / "sample-manifest.json"

    prompt_text = "You are WebOrient, an on-screen web co-pilot."
    if prompt_file.exists():
        prompt_text = prompt_file.read_text(encoding="utf-8")

    manifest_context = ""
    if manifest_file.exists():
        try:
            manifest_data = json.loads(manifest_file.read_text(encoding="utf-8"))
            pages_desc = []
            for p in manifest_data.get("pages", []):
                pages_desc.append(f"- {p.get('title')} ({p.get('route')}): {p.get('summary')}")
            manifest_context = "\n\n### SITE SITEMAP & PAGES:\n" + "\n".join(pages_desc)
        except Exception as e:
            print(f"[WARN] Failed to parse manifest: {e}")

    return prompt_text + manifest_context


def get_gemini_tools():
    return [
        types.Tool(
            function_declarations=[
                types.FunctionDeclaration(
                    name="move_and_highlight",
                    description="Moves the ghost cursor to a DOM element and highlights it with a glowing spotlight border.",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "selector": types.Schema(type=types.Type.STRING, description="CSS selector of element"),
                            "explanation": types.Schema(type=types.Type.STRING, description="Brief explanation of highlight")
                        },
                        required=["selector"]
                    )
                ),
                types.FunctionDeclaration(
                    name="click_element",
                    description="Glides cursor to element, performs a click ripple animation, and triggers DOM click.",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "selector": types.Schema(type=types.Type.STRING, description="CSS selector of element")
                        },
                        required=["selector"]
                    )
                ),
                types.FunctionDeclaration(
                    name="fill_form_field",
                    description="Fills text into an input or textarea with an animated typewriter effect.",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "selector": types.Schema(type=types.Type.STRING, description="CSS selector of input"),
                            "value": types.Schema(type=types.Type.STRING, description="Value to type")
                        },
                        required=["selector", "value"]
                    )
                ),
                types.FunctionDeclaration(
                    name="scroll_page",
                    description="Smoothly scrolls the page up, down, or to a specific section.",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "direction": types.Schema(type=types.Type.STRING, enum=["up", "down", "top", "bottom"]),
                            "targetSelector": types.Schema(type=types.Type.STRING, description="Optional target selector")
                        }
                    )
                ),
                types.FunctionDeclaration(
                    name="navigate_route",
                    description="Navigates the website to another page route.",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "path": types.Schema(type=types.Type.STRING, description="Target route URL path")
                        },
                        required=["path"]
                    )
                )
            ]
        )
    ]


async def handle_browser_client(websocket):
    print(f"[RELAY] Browser client connected from {websocket.remote_address}")
    client = genai.Client(api_key=API_KEY)
    full_prompt = load_system_prompt_and_manifest()
    tools = get_gemini_tools()

    config = types.LiveConnectConfig(
        response_modalities=[types.Modality.AUDIO],
        output_audio_transcription=types.AudioTranscriptionConfig(),
        system_instruction=types.Content(parts=[types.Part.from_text(text=full_prompt)]),
        tools=tools
    )

    try:
        print(f"[RELAY] Connecting to {MODEL_NAME}...")
        async with client.aio.live.connect(model=MODEL_NAME, config=config) as gemini_session:
            print(f"[RELAY] Active session established with {MODEL_NAME}!")

            # Task 1: Forward Gemini outputs (Audio + Tool calls) to browser
            async def forward_gemini_to_browser():
                async for response in gemini_session.receive():
                    sc = response.server_content
                    if sc:
                        # Handle barge-in interruption
                        if getattr(sc, "interrupted", False):
                            await websocket.send(json.dumps({
                                "serverContent": {"interrupted": True}
                            }))

                        # Forward transcript and audio chunks
                        parts = []
                        if sc.model_turn and sc.model_turn.parts:
                            for part in sc.model_turn.parts:
                                if part.inline_data and part.inline_data.data:
                                    import base64
                                    b64_audio = base64.b64encode(part.inline_data.data).decode('utf-8')
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

                    # Forward Tool Calls to browser
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

            # Task 2: Forward browser inputs (Audio chunks + Tool responses) to Gemini
            async def forward_browser_to_gemini():
                async for raw_msg in websocket:
                    try:
                        data = json.loads(raw_msg)

                        # Audio chunks from user microphone
                        if "realtimeInput" in data:
                            media_chunks = data["realtimeInput"].get("mediaChunks", [])
                            for chunk in media_chunks:
                                import base64
                                pcm_bytes = base64.b64decode(chunk["data"])
                                await gemini_session.send_realtime_input(
                                    media=types.Blob(
                                        mime_type="audio/pcm;rate=16000",
                                        data=pcm_bytes
                                    )
                                )

                        # Tool response after ghost cursor completes action
                        elif "toolResponse" in data:
                            responses = data["toolResponse"].get("functionResponses", [])
                            fn_responses = []
                            for r in responses:
                                fn_responses.append(
                                    types.FunctionResponse(
                                        id=r["id"],
                                        name=r.get("name", "tool_result"),
                                        response=r["response"]
                                    )
                                )
                            await gemini_session.send_tool_response(function_responses=fn_responses)

                        # Direct text prompt (for testing)
                        elif "text" in data:
                            await gemini_session.send_realtime_input(text=data["text"])

                    except Exception as err:
                        print(f"[RELAY] Error processing client message: {err}")

            # Run both streaming tasks concurrently
            await asyncio.gather(forward_gemini_to_browser(), forward_browser_to_gemini())

    except websockets.exceptions.ConnectionClosed:
        print("[RELAY] Browser client disconnected.")
    except Exception as exc:
        print(f"[RELAY] Session error: {exc}")


async def main():
    print(f"==================================================")
    print(f" WebOrient Live Relay Server")
    print(f" Target Model : {MODEL_NAME}")
    print(f" WebSocket URI: ws://localhost:{PORT}")
    print(f"==================================================")
    async with websockets.serve(handle_browser_client, "0.0.0.0", PORT):
        await asyncio.Future()  # run forever


if __name__ == "__main__":
    asyncio.run(main())
