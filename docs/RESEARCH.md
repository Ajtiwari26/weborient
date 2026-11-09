# WebOrient Research & Technology Evaluation

This document details the research, technical feasibility, and architectural choices behind **WebOrient**, an AI-driven voice co-browsing agent with an on-screen ghost cursor.

---

## 1. Executive Summary & Problem Space

Traditional website AI assistants are confined to small chat bubbles in the bottom-right corner of the screen. This creates significant friction:
- **Disconnection from Content**: The user reads text in a chat window while having to independently locate the relevant sections, links, and forms on the actual webpage.
- **High Cognitive Load**: Users must describe what they want to fill in or click instead of having the agent interact with the page alongside them.
- **Latency & Turn-taking**: Traditional speech-to-text -> LLM -> text-to-speech pipelines suffer from 2–4 second delays, breaking natural conversational flow.

**WebOrient's approach**:
1. Connects the user to an ultra-low-latency, native **audio-to-audio multimodal model** (e.g. Gemini Multimodal Live API).
2. Deploys an on-screen **"Ghost Cursor"** directly on the webpage matching the site's brand colors.
3. Translates model tool calls in real time into visual actions: smooth cursor motion, element spotlights, animated form typing, and programmatic navigation.

---

## 2. Real-Time Audio-to-Audio Pipeline

### 2.1 Gemini Multimodal Live API Architecture
The Gemini Live API establishes a bidirectional, stateful WebSocket connection (`BidiGenerateContent`):

```
[Browser Mic] ────(16kHz PCM)────► [WebSocket Relay] ────► [Gemini Live API]
                                                                  │
[Browser Speakers] ◄──(24kHz PCM)── [WebSocket Relay] ◄───────────┤ (Audio Out)
[Ghost Cursor DOM] ◄──(Tool Calls)─ [WebSocket Relay] ◄───────────┘ (Function Calls)
```

#### Audio Stream Characteristics:
- **Upstream (Microphone)**: 16-bit Linear PCM, little-endian, 16kHz sample rate, single channel (mono). Audio is captured using `AudioContext` and processed via an `AudioWorklet` (or fallback `ScriptProcessorNode`), packaged into Base64 `realtimeInput.mediaChunks`.
- **Downstream (Model Voice)**: 24kHz raw PCM stream delivered in chunks. The client queues and plays chunks sequentially using Web Audio buffers.
- **Barge-In / Natural Interruption**: When the user starts speaking while the model is responding, Gemini automatically transmits an `interrupted: true` flag in `serverContent`. The client immediately halts playback, clears the audio buffer queue, and resets the cursor to an attentive idle state.

### 2.2 Tool Calling Concurrency
Unlike classic HTTP APIs where tool execution blocks the entire response, the Gemini Live API emits `toolCall` frames *asynchronously* while speaking:
1. User says: *"Can you fill my email as ajay@example.com and show me the pricing?"*
2. Gemini responds with voice: *"Sure! I'm filling out your email now and scrolling down to our plans."*
3. Concurrently, Gemini emits two structured tool calls:
   - `fill_form_field({ selector: "#email", value: "ajay@example.com" })`
   - `move_and_highlight({ selector: "#pricing-table", explanation: "Pricing options" })`
4. The client executes the visual actions, and returns `toolResponse` frames acknowledging completion.

---

## 3. Ghost Cursor Physics & Animation

### 3.1 The Illusion of Human Movement
If a cursor jumps instantaneously between coordinates, users perceive it as jarring and confusing. Human mouse movements follow **Fitts's Law** and curve naturally across the screen.

#### Mathematical Foundation:
1. **Cubic Bézier Trajectories**:
   Instead of a linear path from $P_0$ to $P_3$, two random control points $P_1$ and $P_2$ are generated with perpendicular displacement proportional to travel distance:
   $$B(t) = (1-t)^3 P_0 + 3(1-t)^2 t P_1 + 3(1-t) t^2 P_2 + t^3 P_3, \quad t \in [0, 1]$$
2. **Speed & Deceleration**:
   Movement uses an ease-out cubic timing curve (`cubic-bezier(0.25, 1, 0.5, 1)`) allowing rapid acceleration followed by gentle deceleration as the cursor settles onto the target element.
3. **Fitts's Law Overshoot / Micro-correction**:
   For longer movements, the path slightly overshoots the target bounding box center by 2–5 pixels and smoothly corrects inside the element boundary.

### 3.2 Visual Cursor Actions

| Action | Visual Effect | DOM Event Dispatched |
| :--- | :--- | :--- |
| **Hover** | Cursor scales up slightly (`scale(1.1)`), glowing ring expands. | `mouseenter`, `mouseover` |
| **Click** | Color ring pulses rapidly (`scale(1.6)` with opacity fade), cursor depresses. | `mousedown`, `mouseup`, `click` |
| **Form Fill** | Cursor rests on input right edge; text animates character-by-character with typewriter effect. | `focus`, `input`, `change` |
| **Spotlight** | Element gets surrounded by an illuminated bounding box with glowing drop-shadow. | None (visual CSS overlay) |
| **Scroll** | Cursor anchors to viewport center while page scrolls smoothly. | `window.scrollTo({ behavior: 'smooth' })` |

---

## 4. Open-Source Ecosystem Benchmark

| Project | Key Strengths | Limitations for WebOrient | Our Takeaway |
| :--- | :--- | :--- | :--- |
| **[CopilotKit](https://github.com/CopilotKit/CopilotKit)** | AG-UI protocol, rich React hooks (`useCopilotAction`), generative UI streaming. | Primarily React-specific; lacks built-in visual ghost cursor rendering and audio barge-in pipeline. | Adopt its structured action/tool dispatch protocol for extensible frontend actions. |
| **[LiveKit Agents](https://github.com/livekit/agents)** | Sub-second WebRTC audio streaming, production-ready turn detector and noise suppression. | Requires hosted or self-hosted LiveKit server infrastructure. | Perfect enterprise alternative to raw Gemini WebSockets when WebRTC scalability is needed. |
| **[ghost-cursor](https://github.com/Xetera/ghost-cursor)** | Industry standard for human-like Bézier mouse paths and Fitts's law simulation. | Designed for headless Puppeteer scraping rather than frontend DOM overlays. | Port the Bézier coordinate math directly into the browser client SDK. |
| **[Driver.js](https://github.com/kamranahmedse/driver.js)** | Zero-dependency, lightweight (5kb) SVG spotlight and popover rendering. | Static guided tours; not wired to real-time AI tool calling. | Use its CSS masking and element bounding rect calculations for spotlights. |
| **[rrweb](https://github.com/rrweb-io/rrweb)** | Proven canvas/DOM overlay rendering for tracking and displaying replayed cursors. | Heavy library; focused on full DOM session replay rather than live agent actions. | Replicate its non-blocking overlay design (`pointer-events: none`). |

---

## 5. Site Awareness: Crawler Sitemap & Dynamic DOM Extraction

### 5.1 The Token Economy Problem
Sending full raw HTML to the model on every user turn is costly, introduces latency, and confuses LLM reasoning with irrelevant styling, script tags, and SVGs.

### 5.2 The Two-Tier Awareness Architecture:
1. **Tier 1: Macro Site Manifest (`site-manifest.json`)**:
   Pre-generated during site build or hosted statically. Contains:
   - Available routes and URLs.
   - Purpose and summary of each page.
   - Primary forms and call-to-action buttons.
   - Injected into the model's System Instructions once at session startup.
2. **Tier 2: Micro DOM Scanner (Current Viewport)**:
   A lightweight client function extracts a compact JSON representation of visible, interactive elements on demand:
   ```json
   [
     { "selector": "#full-name", "tag": "input", "type": "text", "label": "Full Name" },
     { "selector": "#email-address", "tag": "input", "type": "email", "label": "Email Address" },
     { "selector": "#btn-submit", "tag": "button", "label": "Book Demo" }
   ]
   ```
   When the user asks *"What can I do on this page?"*, this structured snapshot gives the model immediate grounded context.
