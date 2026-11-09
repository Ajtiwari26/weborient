# WebOrient System Architecture & Specifications (v0.2.0 Optimal Design)

This document outlines the production architectural blueprint, 5-layer runtime design, closed-loop event state machine, cross-page persistence protocol, and security guardrails for **WebOrient**.

---

## 1. High-Level System Architecture

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                             USER BROWSER / CLIENT                                │
│                                                                                  │
│  ┌──────────────────────┐  16kHz PCM   ┌──────────────────────────────────────┐  │
│  │ Web Audio Recorder   │─────────────►│        WebOrient Client SDK          │  │
│  │ (Worklet / PCM16)    │              │                                      │  │
│  └──────────────────────┘              │  ┌────────────────────────────────┐  │  │
│                                        │  │ 1. Perception & Grounding      │  │  │
│  ┌──────────────────────┐  24kHz PCM   │  │    (DOMScanner + Manifest RAG) │  │  │
│  │ Gapless Audio Player │◄─────────────│  └────────────────────────────────┘  │  │
│  │ (Instant Barge-in)   │              │  ┌────────────────────────────────┐  │  │
│  └──────────────────────┘              │  │ 2. Ghost Cursor & Coachmark UI │  │  │
│                                        │  │    (Cubic Bézier + Spotlight)  │  │  │
│  ┌──────────────────────┐  DOM / A11y  │  └────────────────────────────────┘  │  │
│  │ Live Page & Widgets  │◄────────────►│  ┌────────────────────────────────┐  │  │
│  │ (Forms, Tabs, Slides)│  Act + Diff  │  │ 3. Deterministic Actuator      │  │  │
│  └──────────────────────┘              │  │    (Click, Fill, Swipe, Scroll)│  │  │
│                                        │  └────────────────────────────────┘  │  │
│  ┌──────────────────────┐  State Sync  │  ┌────────────────────────────────┐  │  │
│  │ sessionStorage + SPA │◄────────────►│  │ 4. Closed-Loop Verifier        │  │  │
│  │ History Router Hook  │              │  │    (Act -> Settle -> DOM Diff) │  │  │
│  └──────────────────────┘              │  └────────────────────────────────┘  │  │
└────────────────────────────────────────┴──────────────────▲───────────────────┘  │
                                                            │                      
                             Encrypted WebSocket Connection │ (Audio + Text +      
                                                            │  Tool Calls/Outputs) 
                                                            ▼                      
┌──────────────────────────────────────────────────────────────────────────────────┐
│                           WEBORIENT GATEWAY RELAY                                │
│   - API Key Sanitization (never exposes Gemini API key to browser client)        │
│   - Dynamic Context Compiler (injects Agent Prompt + Site Manifest + Knowledge)  │
│   - Bidirectional Streaming Bridge (Audio + Transcripts + 9 DOM Function Tools)  │
└──────────────────────────────────────────────────────────────────────────────────┘
                                                            │
                          Upstream Bidirectional WebSockets │ (Gemini Live API)
                                                            ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                         GOOGLE GEMINI LIVE SERVICE                               │
│   - Model: gemini-3.8-live / gemini-2.0-flash-live                               │
│   - Modalities: Native Audio-to-Audio + Asynchronous Concurrent Tool Calling     │
│   - Automatic VAD Turn Detection & Native Barge-in Interruption                  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Five-Layer Optimal Runtime Design

### Layer 1: Hybrid Perception & Semantic Grounding (`dom-scanner.js` + `site-manifest.json`)
To answer any question accurately and target any element deterministically without overflowing model context tokens:
1. **Persistent `data-wo-id` Indexing**: Every visible interactive element, section landmark, tab, carousel, and form control is assigned a deterministic attribute (`data-wo-id="wo-1"`, `data-wo-id="wo-2"`, etc.) alongside its semantic CSS selector (`#btn-pro`, `[data-wo-id="wo-14"]`).
2. **Three-Tier Knowledge Retrieval (`read_page_content`)**:
   - **Viewport & Section Text Extractor**: Extracts structured headings, pricing cards, tables, FAQs, and visible copy on demand so the agent can answer detailed product or policy questions directly from the live DOM.
   - **Site Manifest Knowledge Base**: Combines route metadata, structured FAQ pairs, and pricing/feature summaries from `site-manifest.json`.
   - **Form & Widget State Inspection**: Reads current input values, selected dropdown options, checked states, active tab/carousel slide indices, and validation error messages (`validationMessage`, `aria-invalid`).

### Layer 2: Persistent Bidirectional Voice Runtime (`live-client.js`)
1. **16kHz Mono PCM Capture**: Captures microphone audio, downsamples/converts `Float32Array` frames to little-endian `Int16Array` PCM, and streams Base64 chunks over the WebSocket relay.
2. **True 24kHz Gapless Web Audio Playback**: Decodes incoming Base64 24kHz Int16 PCM chunks into Web Audio `AudioBuffer` instances scheduled cleanly along `audioContext.currentTime` (`nextPlayTime` cursor) so speech plays smoothly without gaps or clicks.
3. **Sub-50ms Barge-In Cancellation**: Tracks all active `AudioBufferSourceNode` instances in a live set. When `serverContent.interrupted` arrives (or user manually interrupts), every active node calls `.stop(0)` immediately, the playback queue is flushed, and ongoing cursor tours pause cleanly.

### Layer 3: Ghost Cursor Physics & Deictic Visual Explainer (`ghost-cursor.js`)
1. **True Cubic Bézier + Fitts's Law Trajectory**:
   Computes a randomized human-like arc using control points $P_1, P_2$ perpendicular to the travel vector with subtle overshoot and micro-correction on long jumps, rendered at 60fps via `requestAnimationFrame`.
2. **Scroll-Locked Spotlight & Floating Coachmark**:
   When explaining an element (`move_and_highlight` or `guide_tour`), the spotlight bounding box and a floating glassmorphic explanation badge (`explanation` text) lock onto the target element and automatically reposition on `scroll` and `resize` events.
3. **Multi-Step Guided Tours (`guide_tour`)**:
   Steps sequentially through an array of `{ selector, explanation, dwellMs }` waypoints so the agent can visually walk a user through an entire page or workflow in one call.

### Layer 4: Deterministic Action & Gesture Executor (`ghost-cursor.js`)
Separates visual theatrics from framework-compatible DOM actuation:
1. **Reliable Clicking (`click_element`)**:
   Scrolls target into the safe viewport zone, animates the cursor and click ripple, and dispatches the full pointer/mouse sequence (`pointerover` → `mouseenter` → `pointerdown` → `mousedown` → `focus` → `pointerup` → `mouseup` → `click`).
2. **Universal Voice Form Filling (`fill_form_field` & `fill_form_batch`)**:
   - **Voice Input Normalization**: Normalizes spoken emails (`"ajay at example dot com"` → `"ajay@example.com"`), phone numbers, and boolean phrases.
   - **React / Vue / Angular Native Prototype Setters**: Uses `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set` (and `HTMLTextAreaElement` / `HTMLSelectElement` equivalents) so controlled framework state updates reliably.
   - **Rich Control Support**: Handles text/email/number/tel inputs, `<textarea>`, `<select>` (matching either option `value` or visible label), `<input type="checkbox">`, `<input type="radio">`, `<input type="range">` sliders, and `[contenteditable]`.
3. **Smart Scrolling (`scroll_page`)**:
   Supports `up`, `down`, `top`, `bottom`, and `targetSelector`, automatically detecting whether to scroll the main window or a nested scrollable container (e.g., modal body or overflow table).
4. **Swiping, Swapping & Carousels (`swipe_or_swap`)**:
   Handles carousels/sliders (`next`, `prev`, `left`, `right`, or slide index), tab bars (`role="tab"`, `[data-tab]`), toggle switches (`role="switch"`, billing cycle toggles), and range sliders by combining synthetic `PointerEvent`/`TouchEvent` swipe trajectories with semantic button/tab actuation.

### Layer 5: Closed-Loop Verification & Cross-Page Session Continuity (`weborient.js`)
1. **Act → Settle → Diff → Respond Loop**:
   Every mutating tool waits for animations and DOM mutations to settle, then attaches a compact verification payload (`elementFound`, `currentValue`, `validationError`, `activeState`, `visibleInteractiveCount`) in the `toolResponse` so Gemini knows immediately whether the action succeeded or triggered a validation error.
2. **SPA & Multi-Page Session Persistence**:
   - If the target route is an in-page anchor (`#pricing-section`) or SPA route, navigates smoothly without dropping the WebSocket.
   - If a full-page navigation (`window.location.href`) is required, serializes the active session state (`isConnected`, `pendingTask`, `lastRoute`) to `sessionStorage` under `weborient_session_state` and automatically restores the session on the next page load.

---

## 3. Security & Guardrails

1. **Sensitive Field Blacklist**:
   Inputs matching `input[type="password"]`, `input[autocomplete*="cc-"]`, `[data-agent-ignore]`, or `.weborient-ignore` are excluded from scanning, reading, and form filling.
2. **High-Stakes Action Confirmation Gate**:
   Clicking submit buttons (`type="submit"`, `[data-confirm-required]`, or buttons labeled Purchase / Pay / Delete) supports a non-blocking visual confirmation toast or explicit verbal confirmation check unless `confirmed: true` is passed after user approval.
3. **Selector & Execution Sandboxing**:
   All DOM queries and mutations are scoped strictly within `document.body`, ignoring WebOrient's own `#weborient-overlay` container.
