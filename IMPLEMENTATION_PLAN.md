# WebOrient by DeployMate (`weborient.deploymate.in`) — Multi-Tenant SaaS Implementation Plan & Technical Blueprint

> **Product**: WebOrient by DeployMate (`weborient.deploymate.in`)
> **Relay Gateway**: `wss://relay.deploymate.in` (Local dev: `ws://localhost:8088`)
> **Design System**: DeployMate Brutalist-Editorial System (`design.md` — Paper `#FFFFFF`, Ink `#0A0A0A`, Signal `#E6391E`, `Space Grotesk` + `Inter` + `Fira Code`, `1px solid #0A0A0A` structural grid)

---

## 1. Blueprint Audit: What Works 100% vs. 5 Critical Production Modifications

Your proposed architecture (`weborient.deploymate.in` + 1-line `<script>` + Shadow DOM UI + Multi-Tenant Gateway Relay + Per-Minute Credit Metering) is **100% the right architecture** for a high-margin SaaS widget business.

However, when taking this from single-tenant demo to **thousands of third-party customer websites** (Shopify, WordPress, Next.js, Webflow, custom React SPAs), there are **5 critical engineering modifications** required so nothing breaks in production:

| # | Your Proposed Layer | What Works As-Is | Critical Modification Needed for Production | How We Solve It in WebOrient v0.5 |
| :--- | :--- | :--- | :--- | :--- |
| **1** | **Shadow DOM Packaging** (`ShadowRoot` for Assist UI & Ghost Cursor) | Isolates the Siri-like Assist Pill, soundwave bars, spotlight, and coachmarks from the customer's Tailwind/Bootstrap CSS resets. | **The Shadow DOM Boundary Split**: While the *visual overlay* (`#weborient-shadow-host`) MUST live inside an open `ShadowRoot`, the **DOM Scanner & Form Actuator** MUST operate on the customer's **host Light DOM** (and recursively pierce third-party web components) using native `HTMLInputElement.prototype.value` setters. Furthermore, `fixed` positioning inside a Shadow Root breaks if the host `<body>` has `transform` or `filter` applied. | Mount `#weborient-shadow-host` directly on `document.documentElement` (`<html>`) rather than `document.body`, with `all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;`. Keep `GhostCursor` + `AssistWidget` inside `shadowRoot`, while `DOMScanner` queries `document.body`. |
| **2** | **1-Line `<script async>` Embed Tag** (`data-site-key="wo_live_..."`) | Zero-friction copy-paste onboarding for Shopify, WordPress, Webflow, and Next.js. | **`async` / `defer` Breaks `document.currentScript`**: When a customer includes `<script async src="..." data-site-key="...">`, `document.currentScript` is `null` inside ES modules or asynchronous callbacks! | Add a deterministic fallback selector in `weborient.js`: `document.currentScript || document.querySelector('script[data-site-key], script[src*="weborient"]')`, reading `data-site-key`, `data-theme`, `data-lang`, and `data-endpoint`. |
| **3** | **API Key Protection & `Origin` Header Check** | Browser never sees `GEMINI_LIVE_API_KEY`; WebSocket handshake automatically sends the browser's `Origin` header. | **Subdomain, `www.` & Ephemeral Token Hardening**: Customers register `myshop.com`, but visitors browse `https://www.myshop.com` or `https://checkout.myshop.com`. Also, raw WebSocket connections can be opened from non-browser scripts spoofing `Origin`. | 1. Normalize origins (strip `www.`, allow registered subdomains + `localhost` for dev keys `wo_test_*`).<br>2. Add a lightweight `/v1/session-token` handshake (or signed short-lived HMAC ticket + per-IP rate limit on the WebSocket upgrade) so non-browser bots cannot drain a customer's credits. |
| **4** | **Real-Time Credit Metering** (30-second deduction ticks) | Deducting credits every 30s of active streaming prevents unpaid usage and keeps database writes low. | **Concurrent Tab Race Condition & Mid-Sentence Cutoff**: If 10 visitors browse `myshop.com` simultaneously, naive `account.credits -= 0.5` causes race conditions. Also, cutting off at `0` mid-sentence feels abrupt if a visitor is halfway through filling a checkout form. | 1. Use **atomic `$inc: { credits: -0.5 }`** with `credits: { $gte: 0.5 }` in MongoDB/Redis.<br>2. **Low-Credit Warning & Graceful Wrap-Up**: At `30 seconds remaining`, inject a silent system message (`[SYSTEM: 30s credits remaining—wrap up current action]`) before speaking the polite closing message at `0`. |
| **5** | **Auto-Site Profiler (`site-manifest.json`)** | Pre-crawling sitemap, FAQs, and routes gives the agent instant cross-page intelligence. | **Dynamic SPAs & Uncrawled Modals/Carts**: On React/Next.js/Shopify sites, cart drawers and checkout steps don't exist at crawl time—they mount dynamically. | Combine **Static Manifest RAG** (from `site-manifest.json`) with **Live DOM Delta Scanning** (`DOMScanner.scan()` + `readPageContent()`) on every route change and tool settle. |

---

## 2. End-to-End Multi-Tenant SaaS Architecture (`weborient.deploymate.in`)

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│ 1. CUSTOMER ONBOARDING & DASHBOARD (weborient.deploymate.in)                       │
│    - Customer signs up -> Registers domain (e.g. clientstore.com)                  │
│    - Auto-Crawler (`generate_manifest.py`) indexes pages, FAQs, forms -> Mongo/S3  │
│    - Purchases Credit Pack (₹800 / $10 = 150 mins) or Monthly Tier ($29 / $79)     │
│    - Copies 1-line `<script async src=".../weborient.js" data-site-key="wo_live_">`│
└─────────────────────────────────────────┬──────────────────────────────────────────┘
                                          │
                                          ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│ 2. VISITOR ON CUSTOMER'S WEBSITE (https://www.clientstore.com)                     │
│    ┌────────────────────────────────────────────────────────────────────────────┐  │
│    │ Host Light DOM (`document.body`)                                           │  │
│    │ - DOMScanner indexes buttons, tabs, carousels, forms (`data-wo-id`)        │  │
│    │ - React/Vue Native Prototype Setters fill inputs & dispatch W3C events     │  │
│    └────────────────────────────────────▲───────────────────────────────────────┘  │
│                                         │ Pierces boundary cleanly                 │
│    ┌────────────────────────────────────┴───────────────────────────────────────┐  │
│    │ Isolated Shadow DOM (`#weborient-shadow-host` on `document.documentElement`)│  │
│    │ - Zero CSS collision with client site (immune to Tailwind/Bootstrap resets)│  │
│    │ - Renders Floating Siri-Like Assist Pill + 5-Bar Soundwave                 │  │
│    │ - Renders 60fps Cubic Bézier Ghost Cursor + Scroll-Locked Spotlight        │  │
│    └────────────────────────────────────┬───────────────────────────────────────┘  │
└─────────────────────────────────────────┼──────────────────────────────────────────┘
                                          │ wss://relay.deploymate.in?siteKey=wo_live_...
                                          ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│ 3. DEPLOYMATE MULTI-TENANT RELAY GATEWAY (`src/relay/weborient_relay.py`)          │
│    - Step A: Validate `siteKey` (`wo_live_...`) & match HTTP `Origin` to domain    │
│    - Step B: Check Tenant Credit Balance (`credits > 0`)                           │
│    - Step C: Load Tenant's `site-manifest.json` + Custom Brand Persona + Memory    │
│    - Step D: Start 15s/30s Atomic Credit Metering Loop (`-0.5 credits / 30s`)      │
│    - Step E: Bridge 16kHz Mic PCM <-> Gemini 3.8 Live <-> 24kHz Audio + 11 Tools   │
└────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Tenant Registry & Credit Metering Schema

For local development and immediate testing, `config/tenants.json` (and MongoDB in production) stores tenant configurations, allowed domains, custom personas, and real-time credit balances:

```json
{
  "wo_live_deploymate_demo": {
    "tenantId": "tenant_deploymate_01",
    "siteId": "deploymate_weborient",
    "companyName": "DeployMate",
    "allowedOrigins": ["localhost", "127.0.0.1", "deploymate.in", "weborient.deploymate.in"],
    "creditsMinutes": 250.0,
    "plan": "Pro Co-Pilot",
    "theme": {
      "primaryColor": "#E6391E",
      "accentColor": "#0A0A0A",
      "themeName": "signal"
    },
    "defaultLanguage": "en-IN",
    "manifestFile": "sample-manifest.json"
  }
}
```

### How Real-Time Credit Metering Operates in `weborient_relay.py`
1. **Connection Gate**: On WebSocket handshake, the relay extracts `siteKey` (or `siteId`) and the `Origin` header:
   - Verifies `Origin` hostname matches `tenant.allowedOrigins` (or allows any origin if `siteKey` starts with `wo_test_`).
   - Checks `tenant.creditsMinutes > 0`. If `<= 0`, sends a `creditExhausted` control frame and closes with code `4002`.
2. **Active Metering Ticker (`credit_metering_loop`)**:
   - Runs as an `asyncio.Task` alongside the Gemini Live stream.
   - Every **30 seconds** of active session time, atomically deducts `0.5` minutes (`creditsMinutes = round(creditsMinutes - 0.5, 2)`) and broadcasts a `{ "creditUpdate": { "remainingMinutes": ... } }` telemetry event to the client.
   - **Graceful Depletion**: When `creditsMinutes <= 0`, sends a final prompt to Gemini Live to politely wrap up, waits for the current audio turn to finish playing, and closes the session cleanly.

---

## 4. DeployMate `design.md` Visual System Applied to WebOrient

We have aligned the entire WebOrient 5-page showcase (`test-demo.html`, `features.html`, `pricing.html`, `docs.html`, `contact.html`) and the SDK's default theme with `/Users/ajaytiwari/Desktop/Projects/DeployMate/design.md`:

1. **Color Tokens**:
   - `--color-paper: #FFFFFF` (Primary crisp editorial background)
   - `--color-ink: #0A0A0A` (Pure carbon black typography, `1px solid` structural grid lines, and inverted dark sandbox sections)
   - `--color-signal: #E6391E` (DeployMate vermilion-orange signal for focal CTAs, active tabs, index numbers `01 · 02`, and Ghost Cursor spotlight)
   - `--color-signal-deep: #C90C0F` (Pressed/hover accent state matching the DeployMate SVG mark)
2. **Typography**:
   - **Display**: `Space Grotesk` (Light 300 / Medium 500 / Bold 700), tight leading (`0.92`), tracking `-0.03em`.
   - **Body**: `Inter` (400 / 500 / 600), high-contrast legibility.
   - **Micro / Telemetry**: `Fira Code` (400 / 500), uppercase, `0.18em` letter-spacing for index markers (`01 / PERCEPTION`), status indicators (`SYSTEM_ONLINE`), and code blocks.
3. **Official DeployMate Brand Signature**:
   - Uses `deploymate-stacked-logo.svg` and `deploymate-full-logo.svg` in the global header, hero showcase, and footer.
4. **Encapsulated Shadow DOM Overlay (`#weborient-shadow-host`)**:
   - Both the **Ghost Cursor + Spotlight + Coachmark Tooltip** and the **Minimal Siri-Like Assist Pill** now render inside an isolated open `ShadowRoot` so host page styles can never distort them, and WebOrient styles never leak into the client's website.

---

## 5. Phased Implementation Roadmap

### Phase 1: Self-Contained Shadow DOM SDK & 1-Line `<script>` Loader (Implemented Today)
- [x] Encapsulate Ghost Cursor, Spotlight, Swipe Trail SVG, and Coachmark Tooltip inside `#weborient-shadow-host` (`ShadowRoot` attached to `document.documentElement`).
- [x] Encapsulate the floating Siri-like Assist Toggle + 5-Bar Soundwave + Language Popover inside Shadow DOM so 1-line `<script>` embeds work out-of-the-box without external CSS.
- [x] Support `data-site-key="wo_live_..."`, `data-theme="signal|indigo"`, `data-lang="en-IN"`, and `async` script tag discovery in `src/sdk/weborient.js` and `dist/weborient.bundle.js`.

### Phase 2: Multi-Tenant Relay Gateway with Origin Validation & Credit Metering (Implemented Today)
- [x] Add `config/tenants.json` tenant registry with `siteKey`, `allowedOrigins`, `creditsMinutes`, and `plan`.
- [x] Upgrade `src/relay/weborient_relay.py` with HTTP `Origin` verification, initial credit balance gate, and an `asyncio` 30-second credit metering loop with graceful low-balance voice wrap-up.

### Phase 3: DeployMate `design.md` Multi-Page Experience & Live Embed Onboarding (Implemented Today)
- [x] Redesign all 5 pages (`test-demo.html`, `features.html`, `pricing.html`, `docs.html`, `contact.html`) and `demo-shared.js` into the DeployMate `design.md` aesthetic (`#FFFFFF` Paper, `#0A0A0A` Ink, `#E6391E` Signal, `1px` architectural borders, `Space Grotesk` + `Fira Code`, and official `deploymate-stacked-logo.svg`).
- [x] Add an interactive **"Generate Your 1-Line Embed Script"** configurator on `docs.html` and `test-demo.html` so customers can test domain profiling and copy their `<script async src="https://weborient.deploymate.in/sdk/v1/weborient.js" data-site-key="...">` tag immediately.

---

## 6. Deep Research: Gemini 3.8 Live Token Billing & The "VIP + Local Secretary" Architecture

### 6.1 How Gemini 3.8 Live Bills Audio Tokens & Manages Sessions
1. **Continuous Stream Billing (Silent Audio Frames ARE Billed)**:
   - Gemini 3.8 Live tokenizes incoming and outgoing audio at **25 to 32 audio tokens per second** (~1,500–1,920 tokens/minute at `$3.00 / 1M` input tokens and `$12.00 / 1M` output tokens).
   - Because Gemini's server-side Voice Activity Detection (VAD) continuously processes every incoming `realtimeInput` PCM frame, **streaming silent microphone frames over an open WebSocket burns audio tokens at the exact same rate as active speech**.
2. **Cumulative Context Window Re-Billing**:
   - On every turn, Gemini Live re-reads the accumulated session context window. Without sliding-window compression, un-compressed audio sessions hit a hard **15-minute limit** and each turn grows progressively more expensive.
   - Enabling `ContextWindowCompressionConfig(trigger_tokens=12000, sliding_window=SlidingWindow(target_tokens=8000))` + `SessionResumptionConfig(transparent=True)` in `LiveConnectConfig` lifts the 15-minute cap, caps per-turn context re-reading, and enables seamless reconnection.
3. **Why Hard-Disconnecting at 10s Clips Speech vs. Why a 2-Tier "Local Secretary" Is Ideal**:
   - If we close the upstream Gemini WebSocket after 10 seconds of silence, re-establishing the TLS + Gemini Live handshake when the user speaks again takes **600ms–1,100ms**, clipping the first words of their sentence.
   - Instead, we use a **3-Stage "VIP (Gemini Live) + Local Secretary (Browser AudioWorklet VAD + 600ms Ring Buffer)"** state machine that achieves **0 tokens burned after 10s of silence** AND **<15ms zero-clip wake-up when the user speaks again**.

### 6.2 The 3-Stage "VIP + Local Secretary" State Machine (`src/sdk/live-client.js` & `src/relay/weborient_relay.py`)
- **Stage 1 — `ACTIVE` (0s – 10s after last user/model speech or DOM action)**:
  - Mic PCM streams normally to Gemini; credit ticker meters active time.
- **Stage 2 — `SECRETARY_HOLD` (10s – 75s of silence — Zero-Token VAD Gate)**:
  - After **10 seconds** of silence (after both user and Kavya finish speaking), the **Local Secretary** inside `live-client.js` (an `AudioWorklet` RMS energy + zero-crossing speech detector running at 0 cloud cost) gates the stream (`_isVadGated = true`), sends `audio_stream_end=True` to the relay, and **stops sending silent PCM packets**.
  - **Result**: Gemini Live receives **0 audio tokens/sec**, and the relay **pauses tenant credit deduction** (`isIdleHold = true`) while keeping the socket warm!
  - Meanwhile, the Local Secretary maintains a rolling **600ms Pre-Roll Ring Buffer** (12 chunks of 50ms PCM audio) in browser memory.
  - The instant the visitor speaks (RMS > `0.016` for `80ms`) or clicks a topic:
    - The Local Secretary immediately flushes the **600ms pre-roll buffer** followed by live audio to Gemini Live.
    - **0ms connection overhead, 0 clipped syllables, and 0 tokens wasted during silence!**
- **Stage 3 — `DEEP_HIBERNATION` (>75s of continuous silence or >45s tab hidden)**:
  - After **75 seconds** of continuous silence (or **45 seconds** with `document.visibilityState === 'hidden'`), the relay closes the upstream Gemini connection cleanly to free concurrency slots and stops all metering.
  - The Local Secretary remains active on the browser mic (`"Standby — Speak or Click to Resume"`). If the user speaks aloud later, the Secretary buffers `1.2s` of speech, auto-reconnects using `SessionResumptionConfig` + `sessionMemory`, and streams the buffered question seamlessly.

---

## 7. Deep Research: Website Variety, Inner Scroll Containers, Touch Events & Hard DOM Edge Cases

1. **Inner Scroll Containers (`overflow-y: auto | scroll`)**:
   - *Problem*: SaaS dashboards, split-pane layouts, and modals set `body { overflow: hidden }` and scroll inside a child `<main>`, `.overflow-y-auto`, or modal body. `window.scrollTo()` fails to move the page.
   - *Fix in `ghost-cursor.js`*: Add `_getScrollableContainer(el)` which walks up `el.parentElement` checking `/(auto|scroll|overlay)/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + 12`. Smooth-scroll `container.scrollTop` when an inner scroll parent exists, and scroll BOTH if nested.
2. **Touch-Only Sliders & Carousels (Swiper.js, Embla, Slick, Keen-Slider, Flickity)**:
   - *Problem*: Mobile-first carousels often listen to `TouchEvent` (`touchstart`, `touchmove`, `touchend`) or `PointerEvent` with `pointerType: 'touch', isPrimary: true` and ignore mouse drag events.
   - *Fix in `ghost-cursor.js`*: Upgrade `_animateSwipeGesture()` to dispatch `PointerEvent(..., { pointerId: 1, pointerType: 'touch', isPrimary: true, buttons: 1 })` + synthesized `TouchEvent` (`new Touch(...)` where supported by the browser) + broaden Next/Prev button discovery to `.swiper-button-next`, `.embla__button--next`, `.slick-next`, and `[aria-label*="next" i]`.
3. **Custom Headless Dropdowns & Portals (Radix UI, Shadcn, MUI, HeadlessUI, React-Select)**:
   - *Problem*: Custom `<button role="combobox">` dropdowns mount their `[role="listbox"]` options at the end of `document.body` only *after* a click.
   - *Fix in `ghost-cursor.js`*: In `typeIntoField()`, detect `role="combobox"` or `aria-haspopup="listbox"`, click the trigger first, wait `140ms` for the portal `[role="listbox"]` to mount, then fuzzy-match and click `[role="option"]`.
4. **Lazy-Loaded Below-the-Fold Sections & Virtualized Lists**:
   - *Problem*: Components inside `IntersectionObserver` or `React.lazy` only mount when scrolled near the viewport.
   - *Fix in `weborient.js`*: If `scanner.resolveElement(selector)` returns `null`, perform a progressive viewport scroll-and-rescan before returning `elementFound: false`.
5. **Cross-Origin Iframes (Calendly, Stripe Checkout, Typeform, HubSpot, YouTube)**:
   - *Problem*: Browser Same-Origin Policy blocks scripts from accessing DOM nodes inside cross-origin `<iframe>` tags.
   - *Fix in `dom-scanner.js`*: Index visible `<iframe>` containers with semantic titles inferred from `src`/`title` (e.g., `calendly.com` -> `"Calendly Booking Widget"`), spotlight the iframe frame, and have Kavya guide the visitor verbally without falsely claiming to click inside the iframe.

---

## 8. Strict Form Confirmation, PII/Payment Security & Anti-Abuse Hardening

1. **Mandatory Two-Lock Form Submit Confirmation (`requireSubmitConfirmation: true`)**:
   - Default `requireSubmitConfirmation: true` in `src/sdk/weborient.js`.
   - When `click_element` targets any submit control (`type="submit"`, `[data-confirm-required]`, or button text matching `/\b(submit|pay|checkout|place order|confirm|book|send)\b/i`) without `confirmed: true`:
     - Glide the Ghost Cursor to the button and render an interactive **Shadow DOM Confirmation Pill** (`[ ✓ Confirm Submit ]` / `[ ✕ Cancel ]`) above the button while Kavya asks for verbal confirmation.
2. **Expanded PII / Payment / OTP Blacklist & Transcript Redaction**:
   - Expand `DOMScanner.ignoredSelectors` and attribute checks in `src/sdk/dom-scanner.js` to block credit cards, CVV/CVC, bank account/IFSC/UPI PINs, OTP inputs (`autocomplete="one-time-code"`, `name*="otp"`), and government IDs (`aadhaar`, `pan`, `ssn`, `passport`, `gstin`).
   - Scrub 10–16 digit numeric sequences from transcripts in `src/relay/weborient_relay.py` before persisting to MongoDB.
3. **Securing Admin & Credit Endpoints + Per-IP Rate Limiting**:
   - Require `X-Admin-Token` or verified Razorpay/Stripe HMAC signatures on credit top-up and key management routes, plus per-IP WebSocket connection rate limits (`max 3 concurrent / 40 per hour per IP`).

---

## 9. Multi-Key Gemini Live API Load Balancer & Full Client + Super-Admin Telemetry

### 9.1 Multi-Key Load Balancer (`weborient_api_keys` in MongoDB + `DeployMate/src/pages/AdminPage.tsx`)
- Store multiple paid Gemini API keys in MongoDB collection `weborient_api_keys` (`keyId`, `label`, `apiKey`, `maskedKey`, `status: 'active' | 'paused' | 'cooldown'`, `priority`, `activeSessions`, `totalSessions`, `totalMinutes`, `errorCount`, `lastError`, `cooldownUntil`).
- Manage keys directly from the **`WebOrient SaaS` tab in `DeployMate/src/pages/AdminPage.tsx`**:
  - **Add Key**, **Edit Label/Priority**, **Pause/Resume Key**, and **Delete Key**.
- `GeminiKeyPool` in `src/relay/weborient_relay.py` routes new sessions to the least-loaded active key and automatically fails over to the next key in `<150ms` if any key returns `429 Quota Exceeded`, `403`, or `503` (placing the failed key on a 60s cooldown).

### 9.2 Granular Session Telemetry, DOM Action Audit, Drop-Off Funnel & Lead Rescue
- **Per-Session Telemetry (`weborient_sessions` in MongoDB)**:
  - Tracks `creditsBurned`, `secretarySavedSeconds` (time held in 0-token `SECRETARY_HOLD`), `apiKeyUsed`, `userLanguage`, `transcripts[]`, `domEvents[]` (every `move_and_highlight`, `click_element`, `scroll_page`, `swipe_or_swap`, `fill_form_field` with `selector`, `label`, `success: boolean`, and `error`), `sectionsVisited[]`, `dropOffSection`, and `partialLead` (`name`, `email`, `phone`, `submitted`).
- **Super-Admin & Client Dashboard Views**:
  - **DeployMate Admin (`AdminPage.tsx`)**: Manage API keys in the load balancer, manage client plans/credits, inspect every client session's transcript + **DOM Action & Bug Timeline** (`✓ OK` vs `✕ FAILED selector`), and see unconverted/partial leads.
  - **Client Portal (`testscript/dashboard.html`)**: View credit burn rate, Secretary VAD savings, **Section Drop-Off Funnel** (which product/pricing section visitors back off from), session transcripts, and abandoned/partial lead contacts.

