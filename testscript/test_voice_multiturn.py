#!/usr/bin/env python3
"""
Test script verifying continuous multi-turn live conversational audio loop
with Gemini 3.8 Live.
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

API_KEY = os.getenv("GEMINI_LIVE_API_KEY") or os.getenv("GEMINI_API_KEY")
MODEL_NAME = os.getenv("GEMINI_MODEL", "gemini-3.8-live")

from google import genai
from google.genai import types

async def main():
    client = genai.Client(api_key=API_KEY)
    config = types.LiveConnectConfig(
        response_modalities=[types.Modality.AUDIO],
        output_audio_transcription=types.AudioTranscriptionConfig(),
        input_audio_transcription=types.AudioTranscriptionConfig(),
        system_instruction=types.Content(
            parts=[types.Part.from_text(text="You are WebOrient. Reply in one short punchy sentence.")]
        )
    )

    prompt_q = asyncio.Queue()

    print(f"Connecting to {MODEL_NAME}...")
    async with client.aio.live.connect(model=MODEL_NAME, config=config) as session:
        print("[CONNECTED] Testing 3 consecutive turns...")

        async def sender():
            while True:
                txt = await prompt_q.get()
                print(f"[Sender] -> Sending: '{txt}'")
                await session.send_realtime_input(text=txt)

        async def receiver():
            for turn in range(1, 4):
                print(f"[Receiver] Waiting for Turn {turn}...")
                audio_bytes = 0
                transcript = []
                async for resp in session.receive():
                    sc = resp.server_content
                    if sc:
                        if sc.output_transcription and getattr(sc.output_transcription, "text", None):
                            transcript.append(sc.output_transcription.text)
                        if sc.model_turn:
                            for part in sc.model_turn.parts:
                                if part.inline_data and part.inline_data.data:
                                    audio_bytes += len(part.inline_data.data)
                        if getattr(sc, "turn_complete", False):
                            print(f"[Receiver] Turn {turn} COMPLETE! ({audio_bytes} bytes audio)")
                            print(f"           Transcript: '{''.join(transcript)}'")
                            break
            print("[SUCCESS] All 3 turns completed successfully!")

        st = asyncio.create_task(sender())
        rt = asyncio.create_task(receiver())

        await asyncio.sleep(0.5)
        await prompt_q.put("Hello! Tell me your name.")
        await asyncio.sleep(4.0)
        await prompt_q.put("What is this website about?")
        await asyncio.sleep(4.0)
        await prompt_q.put("Can you highlight the pricing?")
        
        await rt
        st.cancel()

if __name__ == "__main__":
    asyncio.run(main())
