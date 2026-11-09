#!/usr/bin/env python3
"""
WebOrient Live Relay Server (v0.2.0)
Bridges browser clients (via WebSocket) with the Gemini 3.8 Live API,
forwarding real-time 16kHz/24kHz audio streams, handling barge-in interruptions,
injecting Site Manifest + Knowledge Base, and dispatching all 10 DOM tool calls
to the on-screen Ghost Cursor.
"""
import asyncio
import base64
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
                route_info = f"{p.get('route')}"
                if p.get("hash"):
                    route_info += f" (or {p.get('hash')})"
                pages_desc.append(f"- {p.get('title')} [{route_info}]: {p.get('summary')}")
                for sec in p.get("sections", []):
                    pages_desc.append(f"  * Section '{sec.get('title')}' ({sec.get('selector')}): {sec.get('description', '')}")
                for form in p.get("forms", []):
                    fields_str = ", ".join(
                        f"{fld.get('label')} ({fld.get('selector')}, type={fld.get('type')})"
                        for fld in form.get("fields", [])
                    )
                    pages_desc.append(f"  * Form '{form.get('description')}' ({form.get('formSelector')}): {fields_str}")

            kb_desc = []
            for kb in manifest_data.get("knowledgeBase", []):
                kb_desc.append(f"- Q: {kb.get('question')}\n  A: {kb.get('answer')}")

            manifest_context = "\n\n### SITE SITEMAP, SECTIONS & FORMS:\n" + "\n".join(pages_desc)
            if kb_desc:
                manifest_context += "\n\n### SITE KNOWLEDGE BASE & FAQ:\n" + "\n".join(kb_desc)
        except Exception as e:
            print(f"[WARN] Failed to parse manifest: {e}")

    return prompt_text + manifest_context


def get_gemini_tools():
    return [
        types.Tool(
            function_declarations=[
                types.FunctionDeclaration(
                    name="move_and_highlight",
                    description="Smoothly glides the ghost cursor to a DOM element, highlights it with a spotlight border, and shows an on-screen explanation badge.",
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
                    description="Navigates the website to a section anchor, SPA route, or page URL.",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "path": types.Schema(type=types.Type.STRING, description="Target route path or section hash, e.g. '/pricing' or '#pricing-section'")
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
                    description="Extracts semantic text, headings, pricing details, FAQs, and manifest knowledge to answer any user question accurately.",
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
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
        system_instruction=types.Content(parts=[types.Part.from_text(text=full_prompt)]),
        tools=tools
    )

    try:
        print(f"[RELAY] Connecting to {MODEL_NAME}...")
        async with client.aio.live.connect(model=MODEL_NAME, config=config) as gemini_session:
            print(f"[RELAY] Active session established with {MODEL_NAME}!")

            # Task 1: Forward Gemini outputs (Audio + Transcripts + Tool calls) to browser
            async def forward_gemini_to_browser():
                async for response in gemini_session.receive():
                    sc = response.server_content
                    if sc:
                        if getattr(sc, "interrupted", False):
                            await websocket.send(json.dumps({
                                "serverContent": {"interrupted": True}
                            }))

                        if sc.input_transcription and getattr(sc.input_transcription, "text", None):
                            await websocket.send(json.dumps({
                                "serverContent": {
                                    "inputTranscription": {"text": sc.input_transcription.text}
                                }
                            }))

                        if sc.output_transcription and getattr(sc.output_transcription, "text", None):
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

            # Task 2: Forward browser inputs (Audio chunks + Tool responses + Text prompts) to Gemini
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
                                        print(f"[RELAY] Streamed {audio_count} mic audio chunks to Gemini Live")

                            elif "toolResponse" in data:
                                responses = data["toolResponse"].get("functionResponses", [])
                                print(f"[RELAY] Delivering tool response to Gemini:", [r.get("name") for r in responses])
                                fn_responses = []
                                for r in responses:
                                    fn_responses.append(
                                        types.FunctionResponse(
                                            id=r["id"],
                                            name=r.get("name", "move_and_highlight"),
                                            response=r["response"]
                                        )
                                    )
                                await gemini_session.send_tool_response(function_responses=fn_responses)

                            elif "text" in data:
                                print(f"[RELAY] User sent text prompt: {data['text']}")
                                await gemini_session.send_realtime_input(text=data["text"])

                        except websockets.exceptions.ConnectionClosed:
                            break
                        except Exception as err:
                            print(f"[RELAY] Error processing client message: {err}")
                except websockets.exceptions.ConnectionClosed:
                    pass

            await asyncio.gather(forward_gemini_to_browser(), forward_browser_to_gemini())

    except websockets.exceptions.ConnectionClosed:
        print("[RELAY] Browser client disconnected.")
    except Exception as exc:
        print(f"[RELAY] Session error: {exc}")


async def main():
    print("==================================================")
    print(" WebOrient Live Relay Server (v0.2.0)")
    print(f" Target Model : {MODEL_NAME}")
    print(f" WebSocket URI: ws://localhost:{PORT}")
    print("==================================================")
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
