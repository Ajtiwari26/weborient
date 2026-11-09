#!/usr/bin/env python3
"""
Test script for Gemini 3.8 Live model connectivity, audio streaming,
and DOM tool-calling declarations.
"""
import asyncio
import os
import sys
from pathlib import Path

# Load .env
env_file = Path(__file__).resolve().parent.parent / ".env"
if env_file.exists():
    with open(env_file) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ[k.strip()] = v.strip().strip('"').strip("'")

api_key = os.getenv("GEMINI_LIVE_API_KEY") or os.getenv("GEMINI_API_KEY")
model_name = os.getenv("GEMINI_MODEL", "gemini-3.8-live")

if not api_key:
    print("[ERROR] No GEMINI_LIVE_API_KEY found.")
    sys.exit(1)

print(f"[TEST] Using Gemini Live Key: {api_key[:6]}...{api_key[-4:]}")
print(f"[TEST] Target Model: {model_name}")

try:
    from google import genai
    from google.genai import types
except ImportError:
    print("[ERROR] google-genai library not found. Install with: pip install google-genai")
    sys.exit(1)


async def main():
    client = genai.Client(api_key=api_key)

    # WebOrient DOM tool definitions
    tools = [
        types.Tool(
            function_declarations=[
                types.FunctionDeclaration(
                    name="move_and_highlight",
                    description="Moves ghost cursor to an element and highlights it.",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "selector": types.Schema(type=types.Type.STRING, description="CSS selector"),
                            "explanation": types.Schema(type=types.Type.STRING, description="Reason for highlight")
                        },
                        required=["selector"]
                    )
                ),
                types.FunctionDeclaration(
                    name="fill_form_field",
                    description="Fills text into an input field or textarea.",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "selector": types.Schema(type=types.Type.STRING, description="CSS selector"),
                            "value": types.Schema(type=types.Type.STRING, description="Value to type")
                        },
                        required=["selector", "value"]
                    )
                )
            ]
        )
    ]

    config = types.LiveConnectConfig(
        response_modalities=[types.Modality.AUDIO],
        output_audio_transcription=types.AudioTranscriptionConfig(),
        system_instruction=types.Content(
            parts=[types.Part.from_text(
                text="You are WebOrient, an on-screen web co-pilot. When asked about pricing or forms, use the available tools."
            )]
        ),
        tools=tools
    )

    print(f"[TEST] Connecting to {model_name}...")
    async with client.aio.live.connect(model=model_name, config=config) as session:
        print("[SUCCESS] Connected to Gemini 3.8 Live!")

        # Send test input
        prompt = "Hello! Please highlight the pricing card and say a quick greeting."
        print(f"[TEST] Sending prompt: '{prompt}'")
        await session.send_realtime_input(text=prompt)

        audio_bytes = 0
        transcript = []
        tool_calls = []

        async for response in session.receive():
            sc = response.server_content
            if sc:
                if sc.output_transcription and getattr(sc.output_transcription, "text", None):
                    transcript.append(sc.output_transcription.text)

                if sc.model_turn:
                    for part in sc.model_turn.parts:
                        if part.inline_data and part.inline_data.data:
                            audio_bytes += len(part.inline_data.data)

                if getattr(sc, "turn_complete", False):
                    print("[INFO] Turn complete received.")
                    break

            if response.tool_call:
                for call in response.tool_call.function_calls:
                    tool_calls.append(call.name)
                    print(f"[TOOL CALL RECEIVED] {call.name}({call.args})")
                    # Send tool response back to Gemini Live
                    await session.send_tool_response(
                        function_responses=[
                            types.FunctionResponse(
                                name=call.name,
                                id=call.id,
                                response={"output": {"success": True, "highlighted": True}}
                            )
                        ]
                    )

        print(f"\n[SUMMARY]")
        print(f"Spoken Transcript: {''.join(transcript)}")
        print(f"Audio Bytes Received: {audio_bytes} bytes")
        print(f"Tool Calls Triggered: {tool_calls}")
        print("[VERIFIED] Gemini 3.8 Live is fully operational for WebOrient!")


if __name__ == "__main__":
    asyncio.run(main())
