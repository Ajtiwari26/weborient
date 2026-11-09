# WebOrient: Voice Co-Browsing & Ghost Cursor Web Agent

> An on-screen AI companion that navigates, highlights, scrolls, and fills forms on websites using real-time bidirectional audio streaming and an interactive **Ghost Cursor**.

---

## 🌟 The Vision

WebOrient transforms standard website navigation from passive reading into an active, guided conversation:
- **Audio-to-Audio Live Interaction**: Talk naturally with the website in real time using the Gemini Multimodal Live API (sub-second speech response, natural barge-in interruptions).
- **Branded Ghost Cursor**: A custom on-screen pointer matches the website's `design.md` color scheme and design language. It moves across the viewport using natural human-like Bézier curves.
- **Visual Grounding**: When the voice model explains a feature or section, the ghost cursor moves to the element and triggers an illuminated spotlight border.
- **Form Co-Pilot**: Dictate answers to contact forms, search bars, or checkout fields; WebOrient visually types character-by-character into the fields and dispatches native browser events.
- **Crawler-Style Site Awareness**: Guided by a lightweight sitemap manifest and a real-time DOM accessibility scanner, the model knows the layout, clickable routes, and input fields without bloating context tokens.

---

## 📁 Repository Structure

```
weborient/
├── README.md                      # Project overview and guide
├── package.json                   # Project scripts and configuration
├── docs/                          # In-depth technical research & specs
│   ├── RESEARCH.md                # Comprehensive research & technology evaluation
│   ├── ARCHITECTURE.md            # System architecture, event loops & dataflows
│   ├── SITEMAP_SPEC.md            # Schema specification for site manifests
│   └── TOOLS_SPEC.md              # Live API function definitions & parameters
├── config/                        # Configuration & model prompts
│   ├── sample-manifest.json       # Example website manifest
│   └── agent-prompt.md            # System instructions & persona prompt
├── src/                           # Core SDK source code
│   └── sdk/
│       ├── ghost-cursor.js        # Bézier curves, ripples, spotlights, typewriter
│       ├── dom-scanner.js         # Semantic DOM extractor & selector generator
│       ├── live-client.js         # Web Audio (16kHz PCM) & WebSocket relay client
│       └── weborient.js           # SDK embed & orchestration entry point
└── testscript/                    # Test scripts & interactive playgrounds
    └── test-demo.html             # Interactive browser test bench for the cursor & DOM actions
```

---

## 🚀 Quick Start & Interactive Demo

To test the Ghost Cursor, click animations, element spotlights, and typewriter form filling right in your browser:

```bash
# Open the test bench in your browser
open testscript/test-demo.html
```

Or run a local static web server:

```bash
npx serve .
# Navigate to http://localhost:3000/testscript/test-demo.html
```

---

## 🧩 Drop-in Embed (Client Websites)

Integrating WebOrient into your own website or any client website requires a single script tag:

```html
<script 
  src="https://cdn.yourdomain.com/weborient.js"
  data-endpoint="https://api.yourdomain.com/v1/live-relay"
  data-theme-color="#6366f1"
  data-cursor-style="modern-glow"
  data-manifest="/weborient-manifest.json">
</script>
```

---

## 📚 Detailed Documentation

- [Detailed Research & Tech Comparisons](docs/RESEARCH.md)
- [System Architecture & Dataflow](docs/ARCHITECTURE.md)
- [Sitemap & DOM Specification](docs/SITEMAP_SPEC.md)
- [Function Calling & Tool Specification](docs/TOOLS_SPEC.md)
