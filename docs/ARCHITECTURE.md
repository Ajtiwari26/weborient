# WebOrient System Architecture & Specifications

This document outlines the architectural blueprint, dataflow pipelines, event state machine, and security guardrails for WebOrient.

---

## 1. High-Level System Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                          USER BROWSER / CLIENT                         │
│                                                                        │
│   ┌────────────────────┐   16kHz PCM    ┌───────────────────────────┐  │
│   │ Web Audio Recorder │───────────────►│  WebOrient Client SDK     │  │
│   └────────────────────┘                │                           │  │
│                                         │  ┌─────────────────────┐  │  │
│   ┌────────────────────┐   24kHz PCM    │  │ Ghost Cursor Engine │  │  │
│   │ Web Audio Player   │◄───────────────│  └─────────────────────┘  │  │
│   │ (Barge-in buffer)  │                │  ┌─────────────────────┐  │  │
│   └────────────────────┘                │  │  DOM Actuator       │  │  │
│                                         │  └─────────────────────┘  │  │
│   ┌────────────────────┐  Action Query  │  ┌─────────────────────┐  │  │
│   │ DOM Scanner        │───────────────►│  │  Route Navigator    │  │  │
│   └────────────────────┘                │  └─────────────────────┘  │  │
└─────────────────────────────────────────┴─────────────▲─────────────┘──┘
                                                        │
                         Encrypted WebSocket Connection │ (Audio Chunks +
                                                        │  Tool Call Events)
                                                        ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        WEBORIENT GATEWAY RELAY                         │
│   - API Key & Token Sanitization (never exposes Gemini API key to web) │
│   - Session Manager & Rate Limiting                                    │
│   - Injects System Prompt + Site Manifest into Session Config          │
└────────────────────────────────────────────────────────────────────────┘
                                                        │
                      Upstream Bidirectional WebSockets │ (Gemini Live Protocol)
                                                        ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     GOOGLE GEMINI LIVE SERVICE                         │
│   - Model: gemini-2.0-flash-exp / gemini-3.x-live                      │
│   - Modalities: Audio Input -> Audio Output + Tool Calls               │
│   - Turn Detection & Dynamic Voice Barge-in                            │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Core System Components

### 2.1 WebOrient Client SDK (`src/sdk/`)
- **`ghost-cursor.js`**: Renders an absolute overlay on the top-most z-index with `pointer-events: none`. Manages cursor coordinate interpolation, SVG theme coloring, click ripple pulses, and typewriter keystrokes into form inputs.
- **`dom-scanner.js`**: Scans the active document for interactive elements (`input`, `button`, `a`, `select`, `textarea`, `[data-agent-action]`). Generates clean, unique CSS selectors and labels.
- **`live-client.js`**: Manages Web Audio context, mic permissions, downsampling float32 audio to 16-bit PCM (16kHz), sending PCM chunks, and receiving 24kHz audio chunks for gapless playback.
- **`weborient.js`**: Orchestrates configuration, initializes the session, and registers tool call handlers.

### 2.2 Gateway Relay Server
To ensure security, production client websites never call the Gemini Live API directly with raw API keys. The gateway provides:
1. **Ephemeral Session Tokens**: Grants temporary access for the active user session.
2. **Context Injection**: Reads the client's `site-manifest.json` and loads it into the model's system instructions.
3. **Audit Logging & Telemetry**: Monitors tool execution frequency and errors.

---

## 3. Agent Event State Machine

```
       ┌────────────────────────┐
       │         IDLE           │
       │ (Cursor hidden/parked) │
       └───────────┬────────────┘
                   │ User presses "Talk to Assistant"
                   ▼
       ┌────────────────────────┐
  ┌───►│       LISTENING        │
  │    │  (Mic streaming PCM)   │
  │    └───────────┬────────────┘
  │                │ User pauses speaking (Turn detected)
  │                ▼
  │    ┌────────────────────────┐
  │    │      PROCESSING        │
  │    │  (Model generates audio│
  │    │   and tool calls)      │
  │    └───────────┬────────────┘
  │                │
  │                ├─────────────────────────────────────────┐
  │                ▼                                         ▼
  │    ┌────────────────────────┐               ┌────────────────────────┐
  │    │     SPEAKING (AUDIO)   │               │   EXECUTING (ACTION)   │
  │    │ (Playing 24kHz stream) │               │ - Move Ghost Cursor    │
  │    └───────────┬────────────┘               │ - Type form inputs     │
  │                │                            │ - Spotlight element    │
  │                │ User barge-in interrupt    │ - Navigate page        │
  │                ▼                            └────────────────────────┘
  │    ┌────────────────────────┐                            │
  └────┤   INTERRUPT / CANCEL   │◄───────────────────────────┘
       │ (Clear audio & actions)│
       └────────────────────────┘
```

---

## 4. Security & Guardrails

To run safely on any client website:
1. **Sensitive Field Exclusion**:
   Input elements with `type="password"`, `autocomplete="cc-number"`, or `data-agent-ignore` are automatically blacklisted from the DOM Scanner and cannot be read or written to by the model.
2. **Action Confirmation Modals**:
   Irreversible actions (e.g. *"Submit Order"*, *"Delete Account"*, or credit card purchase buttons) trigger a visual confirmation prompt requiring physical user confirmation.
3. **Selector Sandboxing**:
   All model-generated CSS selectors are sanitized and restricted to child elements of `document.body` to prevent tampering with browser extensions or parent iframes.
