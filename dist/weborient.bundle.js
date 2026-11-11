/**
 * WebOrient Drop-In Single-File Bundle (v0.4.0)
 * Generated automatically by scripts/bundle.js
 * Includes: SessionMemory (Non-Linear To-Do + Refresh-Safe), DOMScanner (Transcript-to-DOM Auto-Match),
 * GhostCursor, LiveClient, WebOrient
 */
(function(window) {
'use strict';

// --- MODULE: session-memory.js ---
/**
 * WebOrient Persistent Session, Language Note-Taking & Non-Linear To-Do Memory Engine (`src/sdk/session-memory.js` v0.6.0)
 * - Uses `localStorage` (with `sessionStorage` mirror) so session state, active connection status,
 *   detected user language, agent language notes, user goals, and orientation To-Do progress survive
 *   BOTH cross-page redirects AND hard browser refreshes (F5 / Cmd+R).
 * - Multi-Signal Language Detection & Persistent Note-Taking:
 *   Continuously detects user/model language (English, Hindi, Hinglish, Spanish, French), locks it,
 *   records timestamped language notes in `state.languageNotes`, and fires `onLanguageChange` so
 *   what the agent SAYS aloud and what the Ghost Cursor SHOWS on screen stay 100% synchronized.
 */

const MEMORY_STORAGE_KEY = 'weborient_persistent_session_v4';

const SUPPORTED_LANGUAGES = {
  'en-IN': { code: 'en-IN', badge: 'EN', name: 'English (India / Global)' },
  'hi-IN': { code: 'hi-IN', badge: 'HI', name: 'Hindi (हिन्दी)' },
  'hinglish': { code: 'hinglish', badge: 'HINGLISH', name: 'Hinglish (Hindi + English)' },
  'en-US': { code: 'en-US', badge: 'EN', name: 'English (US)' },
  'es-ES': { code: 'es-ES', badge: 'ES', name: 'Español (Spanish)' },
  'fr-FR': { code: 'fr-FR', badge: 'FR', name: 'Français (French)' }
};

const DEFAULT_TODO_CHECKLIST = [
  { id: 'home-hero', page: 'test-demo.html', selector: '#hero-section', title: 'Platform Overview & 310ms Telemetry', keywords: ['telemetry', '310ms', 'latency', 'overview', 'hero', 'conversion lift'], done: false },
  { id: 'home-workflow', page: 'test-demo.html', selector: '#workflow-section', title: '4-Stage Closed-Loop Workflow Tabs', keywords: ['workflow', '4-stage', 'perceive', 'actuate', 'persist'], done: false },
  { id: 'home-cases', page: 'test-demo.html', selector: '#carousel-section', title: 'Customer Case-Study Carousel', keywords: ['case study', 'cloudscale', 'luxecart', 'medflow'], done: false },
  { id: 'home-security', page: 'test-demo.html', selector: '#security-section', title: 'Security & Sensitive Field Guardrails', keywords: ['guardrail', 'password', 'blacklist', 'security matrix'], done: false },
  { id: 'feat-subsystems', page: 'features.html', selector: '#subsystem-tabs-section', title: '5-Layer Subsystem Architecture Tabs', keywords: ['5-layer', 'audioworklet', 'bezier', 'cubic', 'subsystem', 'verifier'], done: false },
  { id: 'feat-industry', page: 'features.html', selector: '#industry-carousel-section', title: 'Industry Deployment Blueprints', keywords: ['industry', 'fintech', 'kyc', 'healthcare', 'triage', 'blueprint'], done: false },
  { id: 'feat-benchmarks', page: 'features.html', selector: '#benchmark-section', title: 'Latency & Cost Benchmark Table', keywords: ['benchmark', 'playwright', 'headless', '310ms vs'], done: false },
  { id: 'price-tiers', page: 'pricing.html', selector: '#pricing-tiers-section', title: 'Pricing Tiers & 20% Annual Billing Switch', keywords: ['pricing', 'starter', 'growth', 'pro co-pilot', 'annual', 'billing', '$79', '$64', '$29'], done: false },
  { id: 'price-roi', page: 'pricing.html', selector: '#roi-calculator-section', title: 'Interactive Revenue Lift ROI Calculator', keywords: ['roi', 'calculator', 'visitors', 'order value', 'revenue lift'], done: false },
  { id: 'price-faq', page: 'pricing.html', selector: '#pricing-faq-section', title: '14-Day Refund & Billing FAQ', keywords: ['refund', 'money-back', '14-day', 'overage', 'cancel'], done: false },
  { id: 'docs-quickstart', page: 'docs.html', selector: '#quickstart-section', title: '2-Minute Client Setup & Framework Snippets', keywords: ['quickstart', 'next.js', 'vue', 'shopify', 'wordpress', 'script tag', 'install'], done: false },
  { id: 'docs-tools', page: 'docs.html', selector: '#tools-reference-section', title: 'Gemini Live API Tool Reference', keywords: ['tool reference', 'move_and_highlight', 'fill_form_batch', 'swipe_or_swap'], done: false },
  { id: 'contact-form', page: 'contact.html', selector: '#intake-form-section', title: '11-Field Enterprise Consultation Form', keywords: ['consultation form', 'intake', 'full name', 'work email', 'priority onboarding', 'hipaa'], done: false },
  { id: 'contact-sla', page: 'contact.html', selector: '#sla-section', title: 'Global Relay Regions & Enterprise SLA', keywords: ['sla', 'san francisco', 'london', 'bengaluru', 'bhopal', '15 minutes'], done: false }
];

const DEMO_PAGES = new Set([
  'test-demo.html',
  'features.html',
  'pricing.html',
  'docs.html',
  'contact.html',
  'dashboard.html'
]);

function isWebOrientDemoSite() {
  if (typeof window === 'undefined') return true;
  const host = (window.location.hostname || '').toLowerCase();
  const file = window.location.pathname.split('/').pop() || '';
  if (DEMO_PAGES.has(file)) return true;
  if (host.startsWith('weborient.')) return true;
  return false;
}

class SessionMemory {
  constructor(options = {}) {
    this.storageKey = options.storageKey || `${MEMORY_STORAGE_KEY}_${options.siteKey || 'default'}`;
    this.onChange = options.onChange || (() => {});
    this.onLanguageChange = options.onLanguageChange || null;
    this.state = this._loadOrInitialize(options);
  }

  _loadOrInitialize(options = {}) {
    const isDemo = isWebOrientDemoSite();
    try {
      const raw = localStorage.getItem(this.storageKey) || sessionStorage.getItem(this.storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.sessionId && Array.isArray(parsed.todoChecklist)) {
          if (!isDemo && parsed.todoChecklist.some(t => t.page === 'test-demo.html')) {
            parsed.todoChecklist = [];
          }
          if (!Array.isArray(parsed.languageNotes)) {
            parsed.languageNotes = [];
          }
          return parsed;
        }
      }
    } catch (_) {}

    const browserLang = (typeof navigator !== 'undefined' && navigator.language) || 'en-IN';
    const initialLang = SUPPORTED_LANGUAGES[browserLang] ? browserLang : 'en-IN';

    const freshState = {
      sessionId: `wo_sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      liveEndpoint:
        options.endpoint ||
        (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
          ? 'ws://localhost:8088'
          : 'wss://relay.deploymate.in'),
      userLanguage: options.defaultLanguage || initialLang,
      languageLocked: false,
      languageNotes: [],
      userIntent: {
        goal: options.defaultGoal || (isDemo
          ? 'Explore WebOrient capabilities, pricing ROI, and setup'
          : `Explore ${typeof document !== 'undefined' && document.title ? document.title : 'website'} solutions, demos, and ROI`),
        interestedTier: isDemo ? 'Pro Co-Pilot' : 'Custom AI Solution',
        customNotes: []
      },
      visitedPages: [],
      todoChecklist: isDemo
        ? DEFAULT_TODO_CHECKLIST.map(item => ({ ...item, completedAt: null }))
        : [],
      orientedHistory: [],
      recentTranscripts: [],
      pendingNavigationActions: [],
      formFacts: {
        fullName: '',
        email: '',
        phone: '',
        company: '',
        website: '',
        framework: 'Next.js / React',
        plan: 'Pro Co-Pilot',
        teamSize: '25'
      }
    };

    this._persist(freshState, false);
    return freshState;
  }

  /**
   * Dynamically populates `todoChecklist` from any client website's live DOM sections
   * or manifest so 1-line `<script>` embeds get automatic non-linear orientation tracking!
   */
  syncDynamicDomChecklist(scanner, manifest = null) {
    if (isWebOrientDemoSite() && this.state.todoChecklist.length > 0) {
      return this.state.todoChecklist;
    }
    if (typeof document === 'undefined') return this.state.todoChecklist;

    const currentRoute = window.location.pathname || '/';
    const existingById = new Map(this.state.todoChecklist.map(item => [item.selector, item]));
    const discovered = [];

    if (manifest && Array.isArray(manifest.pages)) {
      for (const p of manifest.pages) {
        const pageRoute = p.file || p.route || '/';
        for (const sec of p.sections || []) {
          if (!sec.selector) continue;
          const prev = existingById.get(sec.selector);
          discovered.push({
            id: sec.id || sec.selector.replace(/[^a-zA-Z0-9_-]/g, ''),
            page: pageRoute,
            selector: sec.selector,
            title: sec.title || sec.selector,
            keywords: sec.keywords || sec.title?.toLowerCase().split(/\s+/).filter(w => w.length > 3) || [],
            done: prev ? Boolean(prev.done) : false,
            completedAt: prev ? prev.completedAt : null
          });
        }
      }
    }

    if (discovered.length === 0) {
      const sectionEls = Array.from(
        document.querySelectorAll('section[id], [id*="calculator"], [id*="sandbox"], [id*="products"], [id*="pricing"], form[id]')
      );
      for (const el of sectionEls) {
        if (!el.id || el.id.startsWith('weborient') || el.hasAttribute('data-agent-ignore')) continue;
        const selector = `#${el.id}`;
        if (discovered.some(d => d.selector === selector)) continue;
        const headingEl = el.querySelector('h1, h2, h3, h4');
        const rawHeading = headingEl ? headingEl.innerText.replace(/\s+/g, ' ').trim() : '';
        const title = rawHeading || el.id.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        const prev = existingById.get(selector);
        const words = `${title} ${el.id.replace(/[-_]/g, ' ')}`
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter(w => w.length >= 3);

        discovered.push({
          id: el.id,
          page: currentRoute,
          selector,
          title: title.slice(0, 70),
          keywords: Array.from(new Set(words)).slice(0, 8),
          done: prev ? Boolean(prev.done) : false,
          completedAt: prev ? prev.completedAt : null
        });
      }
    }

    if (discovered.length > 0) {
      this.state.todoChecklist = discovered;
      this._persist(this.state, false);
    }
    return this.state.todoChecklist;
  }

  _persist(nextState = this.state, notify = true) {
    nextState.updatedAt = Date.now();
    this.state = nextState;
    try {
      const serialized = JSON.stringify(nextState);
      localStorage.setItem(this.storageKey, serialized);
      sessionStorage.setItem(this.storageKey, serialized);
    } catch (_) {}
    if (notify && typeof this.onChange === 'function') {
      this.onChange(this.state);
    }
  }

  getState() {
    return this.state;
  }

  setLiveSessionStatus(isActive, endpoint = null) {
    this.state.isLiveActive = Boolean(isActive);
    if (endpoint) this.state.liveEndpoint = endpoint;
    this._persist();
  }

  recordPageVisit(pageFile) {
    const cleanFile = String(pageFile || '').split('/').pop() || window.location?.pathname || '/';
    if (!this.state.visitedPages.includes(cleanFile)) {
      this.state.visitedPages.push(cleanFile);
      this._persist();
    }
    return this.state;
  }

  markOriented({ page, selector, title, explanation }) {
    const currentFile = page || (typeof window !== 'undefined' ? (window.location.pathname.split('/').pop() || window.location.pathname || '/') : '/');
    const selStr = String(selector || '').trim();
    if (!selStr) return null;

    const targetEl = typeof document !== 'undefined' ? (() => {
      try { return document.querySelector(selStr); } catch (_) { return null; }
    })() : null;

    for (const todo of this.state.todoChecklist) {
      if (!todo.page || todo.page === currentFile || todo.page === window.location?.pathname) {
        const directMatch =
          todo.selector === selStr ||
          todo.id === selStr.replace(/^#/, '') ||
          (targetEl && (targetEl.matches?.(todo.selector) || targetEl.closest?.(todo.selector) || document.querySelector(todo.selector)?.contains(targetEl)));

        if (directMatch && !todo.done) {
          todo.done = true;
          todo.completedAt = Date.now();
        }
      }
    }

    const key = `${currentFile}::${selStr}`;
    const existingIdx = this.state.orientedHistory.findIndex(item => item.key === key);
    const entry = {
      key,
      page: currentFile,
      selector: selStr,
      title: title || selStr,
      explanation: explanation || null,
      timestamp: Date.now()
    };

    if (existingIdx >= 0) {
      this.state.orientedHistory[existingIdx] = entry;
    } else {
      this.state.orientedHistory.push(entry);
    }

    this._persist();
    return entry;
  }

  markTodoById(todoId, done = true) {
    const item = this.state.todoChecklist.find(
      t => t.id === todoId || t.selector === todoId || t.title.toLowerCase().includes(String(todoId).toLowerCase())
    );
    if (item) {
      item.done = Boolean(done);
      item.completedAt = done ? Date.now() : null;
      this._persist();
    }
    return item;
  }

  /**
   * Updates and locks the user's native language throughout the entire session (surviving redirects & refreshes)
   * and records an explicit agent language note so voice ("saying") and UI tooltip ("showing") stay 100% in sync!
   */
  setLanguage(langCode, lock = true, reason = 'detected from conversation') {
    if (!langCode) return this.getLanguageConfig();
    const prevLang = this.state.userLanguage;
    const norm = String(langCode).trim();
    if (SUPPORTED_LANGUAGES[norm]) {
      this.state.userLanguage = norm;
    } else {
      const lower = norm.toLowerCase();
      if (lower.includes('hinglish')) this.state.userLanguage = 'hinglish';
      else if (lower.includes('hi') || lower.includes('hindi') || /[\u0900-\u097F]/.test(norm)) this.state.userLanguage = 'hi-IN';
      else if (lower.includes('es') || lower.includes('spanish') || lower.includes('español')) this.state.userLanguage = 'es-ES';
      else if (lower.includes('fr') || lower.includes('french') || lower.includes('français')) this.state.userLanguage = 'fr-FR';
      else if (lower.includes('us')) this.state.userLanguage = 'en-US';
      else this.state.userLanguage = 'en-IN';
    }
    if (lock) this.state.languageLocked = true;

    const cfg = this.getLanguageConfig();
    if (!Array.isArray(this.state.languageNotes)) {
      this.state.languageNotes = [];
    }
    if (prevLang !== this.state.userLanguage || this.state.languageNotes.length === 0) {
      const noteEntry = `Silent language sync (${cfg.code}): reply and write Ghost Cursor badges in ${cfg.name} without announcing language aloud.`;
      this.state.languageNotes.push({
        code: cfg.code,
        name: cfg.name,
        note: noteEntry,
        timestamp: Date.now()
      });
      this.state.languageNotes = this.state.languageNotes.slice(-6);
      this.state.userIntent.customNotes = (this.state.userIntent.customNotes || []).filter(
        n => !n.startsWith('[LANG LOCK:') && !n.startsWith('Silent language sync')
      );
      this.state.userIntent.customNotes.push(noteEntry);

      if (typeof this.onLanguageChange === 'function' && (prevLang !== this.state.userLanguage || lock)) {
        queueMicrotask(() => this.onLanguageChange(cfg, prevLang));
      }
    }

    this._persist();
    return cfg;
  }

  /**
   * Auto-detects language strictly from the USER's spoken/typed transcript (never model output)
   * and updates session state silently without announcing the switch aloud.
   */
  detectLanguageFromText(text, role = 'user') {
    if (!text || role !== 'user') return null;
    const clean = String(text).trim();
    const lower = clean.toLowerCase();

    // 1. Explicit user language switch commands always override lock
    if (/\b(speak in english|talk in english|english mein|switch to english|only english)\b/i.test(lower)) {
      return this.setLanguage('en-IN', true, 'explicit user request for English');
    }
    if (/\b(hinglish mein|talk in hinglish|speak hinglish)\b/i.test(lower)) {
      return this.setLanguage('hinglish', true, 'explicit user request for Hinglish');
    }
    if (/\b(hindi mein|talk in hindi|speak in hindi|हिंदी में)\b/i.test(lower)) {
      return this.setLanguage('hi-IN', true, 'explicit user request for Hindi');
    }
    if (/\b(habla en español|speak spanish|in spanish)\b/i.test(lower)) {
      return this.setLanguage('es-ES', true, 'explicit user request for Spanish');
    }
    if (/\b(parle en français|speak french|in french)\b/i.test(lower)) {
      return this.setLanguage('fr-FR', true, 'explicit user request for French');
    }

    // 2. Detect Devanagari script -> Hindi or Hinglish (if mixed with Latin words)
    if (/[\u0900-\u097F]/.test(clean)) {
      const hasLatinWords = /[a-zA-Z]{4,}/.test(clean);
      return this.setLanguage(hasLatinWords ? 'hinglish' : 'hi-IN', true, 'user Devanagari speech transcript');
    }

    // 3. Detect conversational Hinglish / Romanized Hindi markers
    const hinglishMatches = lower.match(
      /\b(kya|kaise|dikhao|dikhaiye|batao|bataiye|samjhao|chaliye|mujhe|mera|meri|humara|hamara|aap|aapka|karo|kariye|kijiye|band|kholo|isko|usko|yeh|ye|woh|wo|hai|hain|aur|mein|ke|ka|ki|se|par|pe|bhi|nahi|haan|accha|theek|kitna|kitne|kahan|kaunsa|dekho|dekhiye|suno|chahiye|krna|karna)\b/g
    );
    if (hinglishMatches && hinglishMatches.length >= 1) {
      return this.setLanguage('hinglish', true, `user Hinglish speech markers (${hinglishMatches.slice(0, 3).join(', ')})`);
    }

    // 4. Detect clear English sentences from user so switching back to English works naturally
    const englishMatches = lower.match(
      /\b(what|how|show|tell|can|you|please|where|which|about|this|that|the|for|with|open|close|book|demo|pricing|features|contact|calculate|voice|website)\b/g
    );
    if (englishMatches && englishMatches.length >= 2) {
      return this.setLanguage('en-IN', true, 'user English speech transcript');
    }

    return null;
  }

  getLanguageConfig() {
    return SUPPORTED_LANGUAGES[this.state.userLanguage] || SUPPORTED_LANGUAGES['en-IN'];
  }

  appendTranscript(role, text) {
    if (!text || !String(text).trim()) return;
    const clean = String(text).replace(/\s+/g, ' ').trim();
    if (role === 'user') {
      this.detectLanguageFromText(clean, 'user');
    }

    const last = this.state.recentTranscripts[this.state.recentTranscripts.length - 1];
    if (last && last.role === role && Date.now() - last.timestamp < 4000) {
      last.text = `${last.text} ${clean}`.slice(-400);
      last.timestamp = Date.now();
    } else {
      this.state.recentTranscripts.push({
        role,
        text: clean.slice(0, 300),
        page: typeof window !== 'undefined' ? (window.location.pathname.split('/').pop() || window.location.pathname || '/') : '/',
        timestamp: Date.now()
      });
    }

    if (this.state.recentTranscripts.length > 14) {
      this.state.recentTranscripts = this.state.recentTranscripts.slice(-14);
    }
    this._persist();
  }

  updateUserIntent({ goal, interestedTier, note, language, todoIdDone, formFactPatch }) {
    if (goal) this.state.userIntent.goal = goal;
    if (interestedTier) this.state.userIntent.interestedTier = interestedTier;
    if (note && !this.state.userIntent.customNotes.includes(note)) {
      this.state.userIntent.customNotes.push(note);
    }
    if (language) {
      this.setLanguage(language, true, 'agent tool update_session_memory');
    }
    if (todoIdDone) {
      this.markTodoById(todoIdDone, true);
    }
    if (formFactPatch && typeof formFactPatch === 'object') {
      Object.assign(this.state.formFacts, formFactPatch);
    }
    this._persist();
    return this.state;
  }

  setPendingNavigationActions(actions = []) {
    this.state.pendingNavigationActions = Array.isArray(actions) ? actions : [];
    this._persist();
  }

  consumePendingNavigationActions() {
    const actions = [...(this.state.pendingNavigationActions || [])];
    this.state.pendingNavigationActions = [];
    this._persist();
    return actions;
  }

  buildModelContextSummary() {
    const langCfg = this.getLanguageConfig();
    const currentFile = typeof window !== 'undefined' ? (window.location.pathname.split('/').pop() || window.location.pathname || '/') : '/';

    const doneItems = this.state.todoChecklist.filter(t => t.done);
    const pendingOnThisPage = this.state.todoChecklist.filter(t => !t.done && (!t.page || t.page === currentFile || t.page === window.location?.pathname));
    const pendingOtherPages = this.state.todoChecklist.filter(t => !t.done && t.page && t.page !== currentFile && t.page !== window.location?.pathname);

    const recentTurns = this.state.recentTranscripts
      .slice(-6)
      .map(t => `  [${t.role.toUpperCase()} on ${t.page}]: ${t.text}`)
      .join('\n') || '  (Session just started)';

    const notesList = (this.state.userIntent.customNotes || []).slice(-5).join(' | ') || `Language locked to ${langCfg.name}`;

    return [
      `=== PERSISTENT SESSION, LANGUAGE NOTES & NON-LINEAR TO-DO MEMORY (${this.state.sessionId}) ===`,
      `1. DETECTED & LOCKED LANGUAGE: ${langCfg.name} (code: ${langCfg.code}).`,
      `   - SHOWING & SAYING SYNC RULE (CRITICAL): Everything you SAY aloud AND every \`explanation\` badge text you pass to \`move_and_highlight\`, \`click_element\`, \`fill_form_field\`, or \`swipe_or_swap\` MUST be in ${langCfg.name}! Never show an English tooltip badge when speaking ${langCfg.name}, and never switch language unless the user asks!`,
      `   - AGENT SESSION NOTES: ${notesList}`,
      `2. USER GOAL / WANT: "${this.state.userIntent.goal}" (Interested Tier: ${this.state.userIntent.interestedTier})`,
      `3. CURRENT ACTIVE PAGE: ${currentFile} (Pages visited so far: ${this.state.visitedPages.join(' -> ') || currentFile})`,
      `4. SITE SECTIONS & FEATURE REFERENCE (For background reference only — do NOT treat as a task list; follow the user naturally at their pace):`,
      `   - SECTIONS ON THIS PAGE (${currentFile}): ${pendingOnThisPage.map(i => `${i.title} -> selector "${i.selector}"`).join(' | ') || 'Interactive sections available on screen'}`,
      `   - OTHER AVAILABLE PAGES: ${pendingOtherPages.map(i => `${i.title} (${i.page})`).join(', ') || 'Available on other pages'}`,
      `   - ZERO TO-DO OBSESSION RULE: There is NO requirement to visit or complete every section. Follow the user's lead, answer their questions patiently, and never rush or push them through a checklist!`,
      `5. FULL PAGE, POPUP & CLOSE-BUTTON CONTROL RULE: Every button, popup, modal, drawer, banner, form input, and Close ('X') button on the screen is indexed with a selector or \`[data-wo-id="wo-..."]\`. Whenever the user asks to open, fill, interact with, or close any popup/modal/drawer/banner/button, immediately call \`click_element\`, \`fill_form_field\`, \`move_and_highlight\`, or \`swipe_or_swap\` on its selector!`,
      `6. RECENT CONVERSATION CONTINUITY (Across Page Redirects / Refreshes):\n${recentTurns}`
    ].join('\n');
  }

  reset() {
    const keepLang = this.state?.userLanguage || 'en-IN';
    const wasConnected = Boolean(this.state?.isLiveActive);
    const endpoint =
      this.state?.liveEndpoint ||
      (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
        ? 'ws://localhost:8088'
        : 'wss://relay.deploymate.in');
    try {
      localStorage.removeItem(this.storageKey);
      sessionStorage.removeItem(this.storageKey);
    } catch (_) {}
    this.state = this._loadOrInitialize({ defaultLanguage: keepLang, endpoint });
    this.state.isLiveActive = wasConnected;
    this._persist();
    return this.state;
  }
}


// --- MODULE: dom-scanner.js ---
/**
 * WebOrient DOM Scanner & Semantic Grounding Engine (v0.6.0 — Full-Page, Popup, Banner & Close-Button Indexing)
 * - Assigns persistent deterministic `data-wo-id` attributes to EVERY actionable element, popup, banner, and close button
 * - Infers semantic labels for icon-only buttons (`<svg class="lucide-x">` -> "Close Popup / Modal (X)", arrows, etc.)
 *   and sibling `<label>` fields (React/Tailwind forms where `<label>` is a sibling of `<input>`)
 * - `scanActiveOverlaysAndPopups()`: detects any open modal, drawer, popup, ad overlay, banner, or expanded dossier
 *   along with its exact `closeButtonSelector` and internal controls
 * - `discoverSiteRoutes()`: indexes all internal routes, hash sections, and SPA navigation triggers from a 1-line embed
 */
class DOMScanner {
  constructor(options = {}) {
    this.ignoredSelectors = options.ignoredSelectors || [
      'input[type="password"]',
      'input[autocomplete*="cc-"]',
      '[data-agent-ignore]',
      '.weborient-ignore',
      '#weborient-overlay',
      '#weborient-overlay *',
      '#weborient-shadow-host',
      '#test-toolbar',
      '#test-toolbar *'
    ];
    this._idCounter = 1;
  }

  /**
   * Real-time Transcript-to-DOM Matcher:
   * Given a phrase currently being spoken by the Gemini Live Agent, finds the best matching
   * DOM section, popup, card, tab, button, or form field on the active page.
   */
  matchElementFromSpeech(spokenText, todoChecklist = []) {
    if (!spokenText || typeof document === 'undefined') return null;
    const text = String(spokenText).toLowerCase().trim();
    if (text.length < 4) return null;

    // 0. If an active modal/popup/drawer is open on screen, prioritize matching controls inside it
    const activePopups = this.scanActiveOverlaysAndPopups();
    if (activePopups.length > 0) {
      const topPopup = activePopups[0];
      if (/\b(close|band|dismiss|cancel|exit|hatay|hatao)\b/i.test(text) && topPopup.closeButtonSelector) {
        const closeEl = this.resolveElement(topPopup.closeButtonSelector);
        if (closeEl) {
          return {
            element: closeEl,
            selector: topPopup.closeButtonSelector,
            title: topPopup.title ? `Close ${topPopup.title}` : 'Close'
          };
        }
      }
    }

    const currentFile = window.location.pathname.split('/').pop() || window.location.pathname || '/';

    // 1. Check current-page To-Do checklist keywords first for high-precision section matching
    const pageTodos = (todoChecklist || []).filter(t => !t.page || t.page === currentFile || t.page === window.location.pathname);
    for (const todo of pageTodos) {
      if (Array.isArray(todo.keywords)) {
        const hit = todo.keywords.some(kw => text.includes(kw.toLowerCase()));
        if (hit) {
          const el = this.resolveElement(todo.selector);
          if (el) {
            return {
              element: el,
              selector: todo.selector,
              title: todo.title,
              todoId: todo.id
            };
          }
        }
      }
    }

    // 2. Match against interactive controls, popups, cards, tabs, headings, and sections on the page
    const candidates = this._querySelectorAllDeep(
      'section[id], [id*="modal"], [id*="drawer"], [id*="calculator"], .pricing-card, [role="tab"], [role="switch"], [data-carousel], details[id], form, button, input, select, h2, h3, h4'
    ).filter(el => !this._isIgnored(el) && this._isVisible(el, true));

    let bestEl = null;
    let bestScore = 0;
    let bestLabel = '';

    for (const el of candidates) {
      const label = (this._extractHeading(el) || this._getAccessibleLabel(el) || '').toLowerCase();
      const idStr = (el.id || '').replace(/[-_]/g, ' ').toLowerCase();
      if (!label && !idStr) continue;

      let score = 0;
      const words = `${label} ${idStr}`.split(/\s+/).filter(w => w.length >= 4 && !['section', 'button', 'input', 'select', 'table'].includes(w));
      for (const w of words) {
        if (text.includes(w)) score += 25;
      }

      if (label.length > 4 && text.includes(label)) score += 60;

      if (score > bestScore && score >= 35) {
        bestScore = score;
        bestEl = el;
        bestLabel = this._extractHeading(el) || this._getAccessibleLabel(el);
      }
    }

    if (bestEl) {
      const targetNode = bestEl.closest('section[id], [id*="modal"], [id*="drawer"], .pricing-card, details[id]') || bestEl;
      return {
        element: targetNode,
        selector: this._getUniqueSelector(targetNode),
        title: bestLabel || this._extractHeading(targetNode)
      };
    }

    return null;
  }

  /**
   * Detects any active modals, popups, drawers, ad overlays, banners, or expanded dossiers
   * currently visible on screen, including their exact Close (`X`) button selector!
   */
  scanActiveOverlaysAndPopups() {
    if (typeof document === 'undefined') return [];
    const popupSelectors = [
      '[role="dialog"]',
      '[aria-modal="true"]',
      '[role="alertdialog"]',
      '#scheduler-booking-modal',
      '#personalize-drawer',
      '[id*="modal" i]',
      '[id*="popup" i]',
      '[id*="drawer" i]',
      '[id*="banner" i]',
      '[class*="modal" i]',
      '[class*="popup" i]',
      '[class*="drawer" i]',
      '.col-span-full.bg-ink',
      'div.fixed.inset-0:not(#weborient-overlay)',
      'div.absolute.inset-x-0.z-20'
    ].join(', ');

    const rawNodes = Array.from(document.querySelectorAll(popupSelectors))
      .filter(el => !this._isIgnored(el) && this._isVisible(el, false));

    const results = [];
    for (const node of rawNodes) {
      const woId = this._ensureWoId(node);
      const selector = this._getUniqueSelector(node);
      const title = this._extractHeading(node) || node.id || 'Active Popup / Overlay';

      // Find close / dismiss button inside this popup/overlay
      let closeBtn = node.querySelector(
        'button[aria-label*="close" i], button[aria-label*="dismiss" i], button[title*="close" i], [data-dismiss], [data-close]'
      );
      if (!closeBtn) {
        const allBtns = Array.from(node.querySelectorAll('button, [role="button"]'));
        closeBtn = allBtns.find(b => this._isCloseOrDismissButton(b)) || null;
      }

      let closeButtonSelector = null;
      if (closeBtn) {
        this._ensureWoId(closeBtn);
        closeButtonSelector = this._getUniqueSelector(closeBtn);
      }

      const controls = Array.from(node.querySelectorAll('button, a[href], input, select, textarea'))
        .filter(c => !this._isIgnored(c) && this._isVisible(c, true))
        .slice(0, 25)
        .map(c => {
          this._ensureWoId(c);
          return {
            selector: this._getUniqueSelector(c),
            tag: c.tagName.toLowerCase(),
            type: c.type || null,
            label: this._getAccessibleLabel(c)
          };
        });

      results.push({
        woId,
        selector,
        title,
        closeButtonSelector,
        textSummary: this._cleanText(node.innerText || '', 320),
        controls
      });
    }
    return results;
  }

  /**
   * Discovers all internal routes, section anchors, and SPA navigation buttons on the client site
   */
  discoverSiteRoutes() {
    if (typeof document === 'undefined') return [];
    const routes = new Map();

    // 1. Anchor links (<a href="...">)
    document.querySelectorAll('a[href]').forEach(a => {
      if (this._isIgnored(a)) return;
      const href = (a.getAttribute('href') || '').trim();
      if (!href || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
      const label = this._getAccessibleLabel(a) || href;
      const selector = this._getUniqueSelector(a);
      if (!routes.has(href)) {
        routes.set(href, { path: href, label, selector, kind: href.startsWith('#') ? 'anchor' : 'link' });
      }
    });

    // 2. SPA Navigation / Action Triggers (e.g. Playground, Start a project, Book demo, Personalize Proposal, Voice agent)
    document.querySelectorAll('header button, nav button, #hero button, footer button, #proposal-personalizer-toggle').forEach(btn => {
      if (this._isIgnored(btn) || !this._isVisible(btn, true)) return;
      const label = this._getAccessibleLabel(btn);
      if (!label) return;
      const selector = this._getUniqueSelector(btn);
      routes.set(`btn:${selector}`, { path: selector, label, selector, kind: 'spa-trigger' });
    });

    return Array.from(routes.values()).slice(0, 35);
  }

  /**
   * Resolves a selector, data-wo-id, element ID, or accessible label (including Close / X buttons) to a DOM element
   */
  resolveElement(target) {
    if (!target) return null;
    if (target instanceof Element) return target;

    const raw = String(target).trim();
    if (!raw) return null;

    if (/^wo-\d+$/i.test(raw)) {
      const byWo = document.querySelector(`[data-wo-id="${raw.toLowerCase()}"]`);
      if (byWo && !this._isIgnored(byWo)) return byWo;
    }

    try {
      const el = document.querySelector(raw);
      if (el && !this._isIgnored(el)) return el;
    } catch (_) {}

    if (!raw.startsWith('#') && !raw.includes(' ')) {
      const byId = document.getElementById(raw);
      if (byId && !this._isIgnored(byId)) return byId;
    }

    const shadowMatch = this._queryShadowRoots(raw);
    if (shadowMatch && !this._isIgnored(shadowMatch)) return shadowMatch;

    const needle = raw.toLowerCase();

    // Special resolution for "close", "close modal", "close popup", "x" when an overlay is open
    if (/\b(close|dismiss|band|exit)\b/i.test(needle)) {
      const popups = this.scanActiveOverlaysAndPopups();
      for (const p of popups) {
        if (p.closeButtonSelector) {
          const btn = document.querySelector(p.closeButtonSelector);
          if (btn) return btn;
        }
      }
    }

    const candidates = this._collectAllCandidateElements();
    let bestMatch = null;
    let bestScore = 0;

    for (const el of candidates) {
      if (this._isIgnored(el) || !this._isVisible(el, true)) continue;
      const label = this._getAccessibleLabel(el).toLowerCase();
      const nameAttr = (el.getAttribute('name') || '').toLowerCase();
      const idAttr = (el.id || '').toLowerCase();

      let score = 0;
      if (label === needle || nameAttr === needle || idAttr === needle) {
        score = 100;
      } else if (label.includes(needle) || (needle.includes(label) && label.length > 2)) {
        score = 75;
      } else if (idAttr.includes(needle) || nameAttr.includes(needle)) {
        score = 60;
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = el;
      }
    }

    return bestMatch;
  }

  /**
   * Scans and returns ALL interactive elements, buttons, inputs, popups, banners, and close buttons on the page
   */
  scan(options = {}) {
    const includeOffscreen = Boolean(options.includeOffscreen);
    const selectorString = [
      'button',
      'a[href]',
      'input',
      'select',
      'textarea',
      'summary',
      '[role="button"]',
      '[role="tab"]',
      '[role="switch"]',
      '[role="slider"]',
      '[role="option"]',
      '[data-carousel]',
      '[data-tab]',
      '[data-agent-action]',
      '[contenteditable="true"]'
    ].join(', ');

    const elements = this._querySelectorAllDeep(selectorString);

    return elements
      .filter(el => this._isVisible(el, includeOffscreen) && !this._isIgnored(el))
      .map(el => {
        const woId = this._ensureWoId(el);
        const rect = el.getBoundingClientRect();
        const inViewport = (
          rect.top < window.innerHeight &&
          rect.bottom > 0 &&
          rect.left < window.innerWidth &&
          rect.right > 0
        );

        const parentSection = el.closest('section[id], [id*="modal"], [id*="drawer"], header, footer');
        const contextId = parentSection ? (parentSection.id || parentSection.tagName.toLowerCase()) : null;

        const item = {
          woId,
          selector: this._getUniqueSelector(el),
          tag: el.tagName.toLowerCase(),
          type: el.type || el.getAttribute('role') || null,
          role: el.getAttribute('role') || null,
          label: this._getAccessibleLabel(el),
          section: contextId,
          inViewport,
          isInteractive: true,
          disabled: Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true')
        };

        if (this._isCloseOrDismissButton(el)) {
          item.isCloseButton = true;
        }

        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
          if (el.type === 'checkbox' || el.type === 'radio') {
            item.checked = Boolean(el.checked);
          } else {
            item.value = el.value || '';
          }
          if (el.tagName === 'SELECT') {
            item.options = Array.from(el.options).map(o => ({
              value: o.value,
              label: o.text.trim(),
              selected: o.selected
            }));
          }
          if (el.type === 'range') {
            item.min = el.min || '0';
            item.max = el.max || '100';
            item.step = el.step || '1';
          }
          if (typeof el.checkValidity === 'function') {
            item.valid = el.checkValidity();
            item.validationMessage = el.validationMessage || null;
          }
        }

        if (el.getAttribute('role') === 'tab' || el.hasAttribute('data-tab')) {
          item.active = el.getAttribute('aria-selected') === 'true' || el.classList.contains('active');
        }

        if (el.getAttribute('role') === 'switch') {
          item.checked = el.getAttribute('aria-checked') === 'true';
        }

        if (el.hasAttribute('data-carousel')) {
          item.carouselState = this._getCarouselState(el);
        }

        return item;
      });
  }

  readPageContent(options = {}) {
    const query = (options.query || '').trim().toLowerCase();
    const targetSelector = options.selector || '';
    const manifest = options.manifest || null;

    if (targetSelector) {
      const targetEl = this.resolveElement(targetSelector);
      if (targetEl && !this._isIgnored(targetEl)) {
        return {
          success: true,
          selector: this._getUniqueSelector(targetEl),
          woId: this._ensureWoId(targetEl),
          title: this._extractHeading(targetEl),
          text: this._cleanText(targetEl.innerText || targetEl.textContent || '', 1500),
          interactiveChildCount: targetEl.querySelectorAll('button, a, input, select, textarea').length
        };
      }
    }

    let sectionNodes = Array.from(
      document.querySelectorAll('section, article, main, [data-section], #roi-savings-calculator, #scheduler-booking-modal, #personalize-drawer, .pricing-card, details')
    ).filter(el => !this._isIgnored(el) && this._isVisible(el, true));

    // Fallback for sectionless SPA takeover pages (like /contact, /playground, /call) that use div.fixed.inset-0 or #root > div
    if (sectionNodes.length === 0) {
      sectionNodes = Array.from(
        document.querySelectorAll('div.fixed.inset-0:not(#weborient-overlay), div.absolute.inset-x-0.z-20, #root > div')
      ).filter(el => !this._isIgnored(el) && this._isVisible(el, true));
    }

    const sections = sectionNodes.map(sec => {
      const woId = this._ensureWoId(sec);
      const heading = this._extractHeading(sec);
      const text = this._cleanText(sec.innerText || '', 650);
      const rect = sec.getBoundingClientRect();
      const inViewport = rect.top < window.innerHeight && rect.bottom > 0;

      return {
        woId,
        selector: this._getUniqueSelector(sec),
        id: sec.id || null,
        heading,
        inViewport,
        summary: text
      };
    });

    const filteredSections = query
      ? sections.filter(s =>
          (s.heading && s.heading.toLowerCase().includes(query)) ||
          (s.summary && s.summary.toLowerCase().includes(query)) ||
          (s.id && s.id.toLowerCase().includes(query))
        )
      : sections;

    const manifestMatches = [];
    if (manifest) {
      if (Array.isArray(manifest.knowledgeBase)) {
        for (const kb of manifest.knowledgeBase) {
          const hay = `${kb.topic || ''} ${kb.question || ''} ${kb.answer || ''}`.toLowerCase();
          if (!query || hay.includes(query) || query.split(/\s+/).some(w => w.length > 3 && hay.includes(w))) {
            manifestMatches.push(kb);
          }
        }
      }
      if (Array.isArray(manifest.pages)) {
        for (const page of manifest.pages) {
          const hay = `${page.title || ''} ${page.summary || ''} ${(page.keywords || []).join(' ')}`.toLowerCase();
          if (!query || hay.includes(query)) {
            manifestMatches.push({
              route: page.route,
              file: page.file,
              title: page.title,
              summary: page.summary
            });
          }
        }
      }
    }

    return {
      success: true,
      pageTitle: document.title,
      currentUrl: window.location.pathname + window.location.hash,
      activePopups: this.scanActiveOverlaysAndPopups(),
      matchingSections: filteredSections.length > 0 ? filteredSections : sections.slice(0, 14),
      manifestKnowledge: manifestMatches.slice(0, 8)
    };
  }

  captureStateSnapshot() {
    const visibleInteractive = this.scan({ includeOffscreen: false });
    const activePopups = this.scanActiveOverlaysAndPopups();
    const invalidFields = visibleInteractive
      .filter(item => item.valid === false)
      .map(item => ({
        selector: item.selector,
        label: item.label,
        validationMessage: item.validationMessage
      }));

    let activeSection = null;
    const sections = Array.from(document.querySelectorAll('section[id], main[id], [data-section]'));
    const viewportCenter = window.innerHeight / 2;
    let minDistance = Infinity;

    for (const sec of sections) {
      if (this._isIgnored(sec)) continue;
      const rect = sec.getBoundingClientRect();
      const center = rect.top + rect.height / 2;
      const dist = Math.abs(center - viewportCenter);
      if (dist < minDistance && rect.bottom > 0 && rect.top < window.innerHeight) {
        minDistance = dist;
        activeSection = sec.id || sec.getAttribute('data-section') || this._extractHeading(sec);
      }
    }

    return {
      url: window.location.pathname + window.location.hash,
      scrollY: Math.round(window.scrollY),
      activeSection,
      activePopups: activePopups.map(p => ({ selector: p.selector, title: p.title, closeButtonSelector: p.closeButtonSelector })),
      visibleInteractiveCount: visibleInteractive.length,
      invalidFields
    };
  }

  _isCloseOrDismissButton(el) {
    if (!el || !(el instanceof Element)) return false;
    const aria = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''} ${el.className || ''}`.toLowerCase();
    if (/\b(close|dismiss|cancel)\b/.test(aria)) return true;
    const txt = (el.innerText || '').trim();
    if (txt === '×' || txt === '✕' || txt === '✖' || /^close$/i.test(txt)) return true;
    const svg = el.querySelector('svg');
    if (svg) {
      const svgClass = (svg.getAttribute('class') || '').toLowerCase();
      if (svgClass.includes('lucide-x') || svgClass.includes('icon-x') || svgClass.includes('close')) {
        return true;
      }
      // Check if it's an X icon path (two crossing diagonal lines: M18 6 6 18 and M6 6 18 18)
      const paths = Array.from(svg.querySelectorAll('path, line')).map(p => p.getAttribute('d') || '').join(' ');
      if (paths.includes('18 6') && paths.includes('6 18')) {
        return true;
      }
    }
    return false;
  }

  _getCarouselState(carouselEl) {
    const slides = Array.from(carouselEl.querySelectorAll('[data-carousel-slide], .carousel-slide'));
    const activeIndex = slides.findIndex(
      s => s.classList.contains('active') || s.getAttribute('aria-hidden') === 'false' || !s.classList.contains('hidden')
    );
    return {
      totalSlides: slides.length,
      activeIndex: activeIndex >= 0 ? activeIndex : 0,
      activeSlideTitle: slides[activeIndex >= 0 ? activeIndex : 0]?.innerText?.trim()?.split('\n')[0] || null
    };
  }

  _ensureWoId(el) {
    if (!el.getAttribute('data-wo-id')) {
      el.setAttribute('data-wo-id', `wo-${this._idCounter++}`);
    }
    return el.getAttribute('data-wo-id');
  }

  _isVisible(el, includeOffscreen = false) {
    if (!el || !(el instanceof Element)) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') {
      return false;
    }
    const isInteractive = /^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(el.tagName);
    if (!isInteractive && parseFloat(style.opacity) === 0) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;

    if (!includeOffscreen) {
      const margin = 100;
      if (
        rect.bottom < -margin ||
        rect.top > window.innerHeight + margin ||
        rect.right < -margin ||
        rect.left > window.innerWidth + margin
      ) {
        return false;
      }
    }
    return true;
  }

  _isIgnored(el) {
    if (!el || !(el instanceof Element)) return true;
    for (const pattern of this.ignoredSelectors) {
      try {
        if (el.matches(pattern) || el.closest(pattern)) {
          return true;
        }
      } catch (_) {}
    }
    return false;
  }

  _getAccessibleLabel(el) {
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim();

    const ariaLabelledBy = el.getAttribute('aria-labelledby');
    if (ariaLabelledBy) {
      const refEl = document.getElementById(ariaLabelledBy);
      if (refEl) return refEl.innerText.trim();
    }

    if (el.id) {
      const labelEl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (labelEl) return labelEl.innerText.trim();
    }

    const parentLabel = el.closest('label');
    if (parentLabel) {
      const cloneText = parentLabel.innerText.trim();
      if (cloneText) return cloneText.slice(0, 80);
    }

    // For inputs/selects/textareas in React/Tailwind forms where <label> is a sibling inside the field wrapper
    if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') {
      const prevLabel = el.previousElementSibling;
      if (prevLabel && (prevLabel.tagName === 'LABEL' || prevLabel.tagName === 'SPAN' || prevLabel.tagName === 'DIV')) {
        const lblTxt = prevLabel.innerText.replace(/\s+/g, ' ').trim();
        const ph = el.getAttribute('placeholder');
        if (lblTxt) return ph ? `${lblTxt} (${ph})` : lblTxt.slice(0, 80);
      }
      const wrapperLabel = el.parentElement?.querySelector('label');
      if (wrapperLabel) {
        const lblTxt = wrapperLabel.innerText.replace(/\s+/g, ' ').trim();
        const ph = el.getAttribute('placeholder');
        if (lblTxt) return ph ? `${lblTxt} (${ph})` : lblTxt.slice(0, 80);
      }
    }

    const placeholder = el.getAttribute('placeholder');
    if (placeholder) return placeholder.trim();

    const title = el.getAttribute('title') || el.getAttribute('data-tooltip');
    if (title) return title.trim();

    const text = (el.innerText || el.value || '').replace(/\s+/g, ' ').trim();
    if (text) return text.slice(0, 90);

    // Icon-only button inference (Close 'X' buttons, arrows, mic, send, etc.)
    if (this._isCloseOrDismissButton(el)) {
      const modalParent = el.closest('[id*="modal"], [id*="drawer"], [role="dialog"], .col-span-full');
      const modalTitle = modalParent ? (this._extractHeading(modalParent) || modalParent.id) : 'Popup';
      return `Close ${modalTitle} (X)`;
    }

    const svg = el.querySelector('svg');
    if (svg) {
      const cls = (svg.getAttribute('class') || '').toLowerCase();
      if (cls.includes('arrow-left') || cls.includes('chevron-left')) return 'Previous';
      if (cls.includes('arrow-right') || cls.includes('chevron-right')) return 'Next';
      if (cls.includes('send')) return 'Send';
      if (cls.includes('mic')) return 'Microphone / Voice';
    }

    return '';
  }

  _getUniqueSelector(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;
    if (el.getAttribute('data-agent-id')) {
      return `[data-agent-id="${el.getAttribute('data-agent-id')}"]`;
    }
    if (el.getAttribute('data-tab')) {
      return `[data-tab="${el.getAttribute('data-tab')}"]`;
    }
    if (el.name && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) {
      return `${el.tagName.toLowerCase()}[name="${el.name}"]`;
    }
    const woId = this._ensureWoId(el);
    return `[data-wo-id="${woId}"]`;
  }

  _extractHeading(el) {
    if (/^H[1-6]$/.test(el.tagName)) return el.innerText.trim();
    const h = el.querySelector('h1, h2, h3, h4, summary, [data-title]');
    if (h) return h.innerText.replace(/\s+/g, ' ').trim();
    return el.getAttribute('aria-label') || el.id || '';
  }

  _cleanText(raw, maxLength = 600) {
    const cleaned = String(raw).replace(/\s+/g, ' ').trim();
    return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}...` : cleaned;
  }

  _querySelectorAllDeep(selector, root = document.body) {
    if (!root) return [];
    const results = Array.from(root.querySelectorAll(selector));
    const allNodes = root.querySelectorAll('*');
    for (const node of allNodes) {
      if (node.shadowRoot && node.id !== 'weborient-shadow-host') {
        results.push(...this._querySelectorAllDeep(selector, node.shadowRoot));
      }
    }
    return results;
  }

  _queryShadowRoots(selector, root = document.body) {
    if (!root) return null;
    const allNodes = root.querySelectorAll('*');
    for (const node of allNodes) {
      if (node.shadowRoot && node.id !== 'weborient-shadow-host') {
        try {
          const found = node.shadowRoot.querySelector(selector);
          if (found) return found;
        } catch (_) {}
        const nested = this._queryShadowRoots(selector, node.shadowRoot);
        if (nested) return nested;
      }
    }
    return null;
  }

  _collectAllCandidateElements() {
    return this._querySelectorAllDeep(
      'button, a, input, select, textarea, summary, section, article, [role], [data-tab], [data-carousel], h1, h2, h3, h4'
    );
  }
}


// --- MODULE: ghost-cursor.js ---
/**
 * WebOrient Ghost Cursor & Deterministic UI Actuator (v0.5.0 — DeployMate Shadow DOM Edition)
 * - Encapsulated inside an open ShadowRoot (`#weborient-shadow-host` on `document.documentElement`)
 *   so client website CSS (Tailwind/Bootstrap resets, body transforms) never distorts the cursor or spotlight
 * - DeployMate Signal (`#E6391E`) & Ink (`#0A0A0A`) Brutalist-Editorial Coachmark & Spotlight aesthetic
 * - True Cubic Bézier + Fitts's Law human-like 60fps cursor trajectory with tip hotspot offset
 * - Exact smooth scroll completion listener (`_smoothScrollTo`) so elements are 100% settled in center
 * - Cross-page cursor coordinate persistence (`weborient_cursor_pos_v5`)
 * - React/Vue/Angular compatible form filling (`HTMLInputElement.prototype.value` setter)
 */

const CURSOR_POS_STORAGE_KEY = 'weborient_cursor_pos_v5';

class GhostCursor {
  constructor(options = {}) {
    this.primaryColor = options.primaryColor || '#E6391E';
    this.accentColor = options.accentColor || '#0A0A0A';
    this.cursorStyle = options.cursorStyle || 'deploymate-signal';
    this.scanner = options.scanner || null;

    this.currentPosition = this._loadStoredPosition();
    this.isMoving = false;
    this.activeTarget = null;
    this.activeExplanation = null;
    this._abortController = null;
    this._rafId = null;
    this._moveCancelResolve = null;

    this._initOverlay();
  }

  _loadStoredPosition() {
    if (typeof window === 'undefined') return { x: 500, y: 400 };
    try {
      const raw = sessionStorage.getItem(CURSOR_POS_STORAGE_KEY) || localStorage.getItem(CURSOR_POS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
          return {
            x: Math.max(12, Math.min(window.innerWidth - 24, parsed.x)),
            y: Math.max(12, Math.min(window.innerHeight - 24, parsed.y))
          };
        }
      }
    } catch (_) {}
    return {
      x: Math.round(window.innerWidth / 2),
      y: Math.round(window.innerHeight / 2)
    };
  }

  _saveCurrentPosition() {
    if (typeof window === 'undefined') return;
    try {
      const payload = JSON.stringify({
        x: Math.round(this.currentPosition.x),
        y: Math.round(this.currentPosition.y)
      });
      sessionStorage.setItem(CURSOR_POS_STORAGE_KEY, payload);
      localStorage.setItem(CURSOR_POS_STORAGE_KEY, payload);
    } catch (_) {}
  }

  /**
   * Mounts or reuses `#weborient-shadow-host` on `document.documentElement` (`<html>`)
   * with an open ShadowRoot so host website CSS rules can never collide with WebOrient UI.
   */
  getOrCreateShadowRoot() {
    if (typeof document === 'undefined') return null;
    let host = document.getElementById('weborient-shadow-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'weborient-shadow-host';
      host.setAttribute('data-agent-ignore', 'true');
      host.style.cssText = 'all: initial; position: fixed; inset: 0; width: 0; height: 0; pointer-events: none; z-index: 2147483647;';
      (document.documentElement || document.body).appendChild(host);
    }
    return host.shadowRoot || host.attachShadow({ mode: 'open' });
  }

  _initOverlay() {
    if (typeof document === 'undefined') return;
    const legacyOverlay = document.getElementById('weborient-overlay');
    if (legacyOverlay) legacyOverlay.remove();

    this.shadowRoot = this.getOrCreateShadowRoot();
    if (!this.shadowRoot) return;

    const existing = this.shadowRoot.getElementById('weborient-overlay');
    if (existing) existing.remove();

    this.container = document.createElement('div');
    this.container.id = 'weborient-overlay';
    this.container.setAttribute('data-agent-ignore', 'true');
    this.container.style.cssText = `
      position: fixed;
      top: 0; left: 0;
      width: 100vw; height: 100vh;
      pointer-events: none;
      z-index: 2147483647;
      overflow: hidden;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    `;

    // Spotlight Element Bounding Box (DeployMate Signal #E6391E crisp architectural frame)
    this.spotlight = document.createElement('div');
    this.spotlight.id = 'weborient-spotlight';
    this.spotlight.style.cssText = `
      position: fixed;
      border: 2px solid ${this.primaryColor};
      border-radius: 6px;
      box-shadow: 0 0 0 1px rgba(10, 10, 10, 0.25), 0 0 28px ${this.primaryColor}55, inset 0 0 14px ${this.primaryColor}22;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.2s ease, top 0.12s cubic-bezier(0.215, 0.61, 0.355, 1), left 0.12s cubic-bezier(0.215, 0.61, 0.355, 1), width 0.16s cubic-bezier(0.215, 0.61, 0.355, 1), height 0.16s cubic-bezier(0.215, 0.61, 0.355, 1);
      z-index: 2147483645;
    `;

    // Floating Explanation Coachmark / Tooltip (DeployMate Ink #0A0A0A + Signal #E6391E border)
    this.tooltip = document.createElement('div');
    this.tooltip.id = 'weborient-tooltip';
    this.tooltip.style.cssText = `
      position: fixed;
      max-width: 360px;
      padding: 8px 14px;
      background: #0A0A0A;
      border: 1.5px solid ${this.primaryColor};
      border-radius: 999px;
      color: #FFFFFF;
      font-family: 'Fira Code', ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      line-height: 1.4;
      font-weight: 500;
      letter-spacing: 0.04em;
      box-shadow: 0 12px 28px -6px rgba(0, 0, 0, 0.45);
      pointer-events: none;
      opacity: 0;
      transform: translateY(4px);
      transition: opacity 0.2s ease, transform 0.2s ease, top 0.12s ease-out, left 0.12s ease-out;
      z-index: 2147483646;
    `;

    // Swipe Trail SVG Canvas
    this.trailSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.trailSvg.setAttribute('width', '100%');
    this.trailSvg.setAttribute('height', '100%');
    this.trailSvg.style.cssText = `
      position: fixed;
      top: 0; left: 0;
      width: 100vw; height: 100vh;
      pointer-events: none;
      z-index: 2147483645;
    `;
    this.trailPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    this.trailPath.setAttribute('fill', 'none');
    this.trailPath.setAttribute('stroke', this.primaryColor);
    this.trailPath.setAttribute('stroke-width', '3.5');
    this.trailPath.setAttribute('stroke-linecap', 'round');
    this.trailPath.setAttribute('stroke-dasharray', '7 5');
    this.trailPath.style.opacity = '0';
    this.trailPath.style.transition = 'opacity 0.35s ease';
    this.trailSvg.appendChild(this.trailPath);

    // Ghost Cursor Pointer (Tip hotspot at SVG (4, 3) aligned to (0, 0) via margin offset)
    this.cursor = document.createElement('div');
    this.cursor.id = 'weborient-cursor';
    this.cursor.innerHTML = `
      <div class="weborient-pointer" style="position: relative; width: 30px; height: 30px; margin-left: -4px; margin-top: -3px; transition: transform 0.18s ease-out;">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" style="filter: drop-shadow(0 4px 10px rgba(10,10,10,0.38));">
          <path d="M4 3L11 20L14.5 13.5L21 11L4 3Z" fill="${this.primaryColor}" stroke="#0A0A0A" stroke-width="1.6" stroke-linejoin="round"/>
        </svg>
        <div class="weborient-ring" style="
          position: absolute; top: -11px; left: -10px; width: 28px; height: 28px;
          border: 2.5px solid ${this.primaryColor}; border-radius: 50%;
          opacity: 0; transform: scale(0.5);
          transition: transform 0.28s ease-out, opacity 0.28s ease-out;
        "></div>
      </div>
    `;
    this.cursor.style.cssText = `
      position: fixed;
      top: 0; left: 0;
      transform: translate3d(${this.currentPosition.x}px, ${this.currentPosition.y}px, 0);
      will-change: transform;
      pointer-events: none;
      z-index: 2147483647;
    `;

    this.container.appendChild(this.trailSvg);
    this.container.appendChild(this.spotlight);
    this.container.appendChild(this.tooltip);
    this.container.appendChild(this.cursor);
    this.shadowRoot.appendChild(this.container);

    this._boundSyncPosition = () => this._syncSpotlightPosition();
    window.addEventListener('scroll', this._boundSyncPosition, { passive: true, capture: true });
    window.addEventListener('resize', this._boundSyncPosition, { passive: true });
  }

  showSpeechBubble() {}
  hideSpeechBubble() {}

  async performSpeakingGesture(el) {
    if (!el || !document.body.contains(el)) return;
    const rect = el.getBoundingClientRect();
    const baseX = Math.max(16, Math.min(window.innerWidth - 24, rect.left + rect.width * 0.35));
    const baseY = Math.max(16, Math.min(window.innerHeight - 24, rect.top + Math.min(48, rect.height * 0.4)));
    await this.moveTo(baseX + 24, baseY - 6, 300);
    await this.moveTo(baseX, baseY, 300);
  }

  _resolve(selectorOrElement) {
    if (!selectorOrElement) return null;
    if (selectorOrElement instanceof Element) return selectorOrElement;
    if (this.scanner) {
      const resolved = this.scanner.resolveElement(selectorOrElement);
      if (resolved) return resolved;
    }
    try {
      return document.querySelector(selectorOrElement);
    } catch (_) {
      return null;
    }
  }

  /**
   * Deterministic smooth scroll that waits until window.scrollY reaches targetScrollY.
   * Works seamlessly with both native browser scrolling AND custom smooth-scroll engines (Lenis / Locomotive).
   */
  async _smoothScrollTo(targetScrollY, maxWaitMs = 680) {
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const clampedTarget = Math.max(0, Math.min(maxScroll, Math.round(targetScrollY)));
    const initialY = window.scrollY;

    if (Math.abs(initialY - clampedTarget) <= 8) {
      return;
    }

    const hasLenis = document.documentElement.classList.contains('lenis');
    if (!hasLenis) {
      window.scrollTo({ top: clampedTarget, behavior: 'smooth' });
    }

    return new Promise(resolve => {
      const startTime = performance.now();
      let lastY = window.scrollY;
      let settledFrames = 0;
      let useManualTween = hasLenis;

      const checkScroll = (now) => {
        const elapsed = now - startTime;

        // If native smooth scroll was intercepted or blocked by a host scroll library after 95ms, switch to direct 60fps cubic-out tween
        if (!useManualTween && elapsed > 95 && Math.abs(window.scrollY - initialY) < 2) {
          useManualTween = true;
        }

        if (useManualTween) {
          const duration = Math.min(540, maxWaitMs);
          const progress = Math.min(1, elapsed / duration);
          const easeOutCubic = 1 - Math.pow(1 - progress, 3);
          const nextY = Math.round(initialY + (clampedTarget - initialY) * easeOutCubic);
          window.scrollTo(0, nextY);
          this._syncSpotlightPosition();
          if (progress >= 1 || Math.abs(window.scrollY - clampedTarget) <= 3) {
            window.scrollTo(0, clampedTarget);
            this._syncSpotlightPosition();
            resolve();
            return;
          }
          requestAnimationFrame(checkScroll);
          return;
        }

        const currentY = window.scrollY;
        this._syncSpotlightPosition();

        const dist = Math.abs(currentY - clampedTarget);
        const delta = Math.abs(currentY - lastY);
        lastY = currentY;

        if (dist <= 3) {
          resolve();
          return;
        }

        if (delta < 0.5 && elapsed > 140) {
          settledFrames++;
          if (settledFrames >= 4) {
            resolve();
            return;
          }
        } else {
          settledFrames = 0;
        }

        if (elapsed >= maxWaitMs) {
          resolve();
          return;
        }

        requestAnimationFrame(checkScroll);
      };

      requestAnimationFrame(checkScroll);
    });
  }

  /**
   * Moves cursor along a human-like Cubic Bézier trajectory with Fitts's Law easing
   */
  async moveTo(targetX, targetY, durationMs = 460) {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    if (this._moveCancelResolve) {
      const prevResolve = this._moveCancelResolve;
      this._moveCancelResolve = null;
      prevResolve();
    }

    const clampedX = Math.max(8, Math.min(window.innerWidth - 16, targetX));
    const clampedY = Math.max(8, Math.min(window.innerHeight - 16, targetY));

    const startX = this.currentPosition.x;
    const startY = this.currentPosition.y;
    const dx = clampedX - startX;
    const dy = clampedY - startY;
    const distance = Math.hypot(dx, dy);

    if (distance < 2) {
      this.currentPosition = { x: clampedX, y: clampedY };
      this.cursor.style.transform = `translate3d(${clampedX.toFixed(1)}px, ${clampedY.toFixed(1)}px, 0)`;
      this._saveCurrentPosition();
      return;
    }

    const scaledDuration = Math.min(720, Math.max(200, durationMs * (0.52 + Math.log2(distance / 65 + 1) * 0.22)));

    const nx = -dy / distance;
    const ny = dx / distance;
    const arcSign = (startX + startY) % 2 === 0 ? 1 : -1;
    const arcRadius = Math.min(75, distance * 0.18) * arcSign;

    const p1x = startX + dx * 0.28 + nx * arcRadius;
    const p1y = startY + dy * 0.28 + ny * arcRadius;

    const overshoot = distance > 180 ? 3.5 : 0;
    const p2x = startX + dx * 0.76 + nx * (arcRadius * 0.3) + (dx / distance) * overshoot;
    const p2y = startY + dy * 0.76 + ny * (arcRadius * 0.3) + (dy / distance) * overshoot;

    this.isMoving = true;
    this.cursor.style.transition = 'none';

    return new Promise(resolve => {
      this._moveCancelResolve = resolve;
      const startTime = performance.now();

      const step = (now) => {
        const elapsed = now - startTime;
        const rawT = Math.min(1, elapsed / scaledDuration);
        const t = 1 - Math.pow(1 - rawT, 3);
        const u = 1 - t;

        const x = (u * u * u) * startX +
                  3 * (u * u) * t * p1x +
                  3 * u * (t * t) * p2x +
                  (t * t * t) * clampedX;

        const y = (u * u * u) * startY +
                  3 * (u * u) * t * p1y +
                  3 * u * (t * t) * p2y +
                  (t * t * t) * clampedY;

        this.currentPosition = { x, y };
        this.cursor.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;

        if (rawT < 1) {
          this._rafId = requestAnimationFrame(step);
        } else {
          this.isMoving = false;
          this._rafId = null;
          this._moveCancelResolve = null;
          this.currentPosition = { x: clampedX, y: clampedY };
          this.cursor.style.transform = `translate3d(${clampedX.toFixed(1)}px, ${clampedY.toFixed(1)}px, 0)`;
          this._saveCurrentPosition();
          resolve();
        }
      };

      this._rafId = requestAnimationFrame(step);
    });
  }

  _syncSpotlightPosition() {
    if (!this.activeTarget || !document.body.contains(this.activeTarget)) {
      this.hideSpotlight();
      return;
    }

    const rect = this.activeTarget.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      this.hideSpotlight();
      return;
    }

    const header = document.querySelector('#global-site-header, header, [data-site-header]');
    const isInsideHeader = header && header.contains(this.activeTarget);
    const headerBottom = (!isInsideHeader && header) ? Math.max(0, header.getBoundingClientRect().bottom) : 0;

    const pad = 6;
    const safeTop = isInsideHeader ? Math.max(4, rect.top - pad) : Math.max(headerBottom + 4, rect.top - pad);
    const safeLeft = rect.left - pad;
    const safeWidth = rect.width + pad * 2;
    const safeHeight = Math.max(0, (rect.bottom + pad) - safeTop);

    if (safeHeight <= 6 || (!isInsideHeader && rect.bottom <= headerBottom) || rect.top >= window.innerHeight) {
      this.spotlight.style.opacity = '0';
      if (this.tooltip) this.tooltip.style.opacity = '0';
      return;
    }

    this.spotlight.style.top = `${safeTop}px`;
    this.spotlight.style.left = `${safeLeft}px`;
    this.spotlight.style.width = `${safeWidth}px`;
    this.spotlight.style.height = `${safeHeight}px`;
    this.spotlight.style.opacity = '1';

    if (this.activeExplanation) {
      this.tooltip.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${this.primaryColor};flex-shrink:0;"></span>
          <span>${this._escapeHtml(this.activeExplanation)}</span>
        </div>
      `;

      // Smart boundary placement: Tooltip MUST NEVER touch or overlap the highlighted component or spotlight
      const CLEARANCE = 22; // Strict safety buffer so tooltip never touches component boundary
      const tooltipW = Math.min(380, Math.max(220, this.tooltip.offsetWidth || 280));
      const tooltipH = Math.max(34, this.tooltip.offsetHeight || 38);

      const spaceAbove = safeTop - headerBottom;
      const spaceBelow = window.innerHeight - (safeTop + safeHeight);

      let topPos;
      let leftPos = Math.max(16, Math.min(window.innerWidth - tooltipW - 16, safeLeft + (safeWidth - tooltipW) / 2));

      if (!isInsideHeader && spaceAbove >= tooltipH + CLEARANCE + 10) {
        // Place strictly above component with clear boundary
        topPos = safeTop - tooltipH - CLEARANCE;
      } else if (spaceBelow >= tooltipH + CLEARANCE + 16) {
        // Place strictly below component with clear boundary
        topPos = safeTop + safeHeight + CLEARANCE;
      } else {
        // Component is tall or near viewport edges: dock cleanly at top safe boundary below header
        topPos = Math.max(headerBottom + 16, 20);
        leftPos = Math.max(16, Math.min(window.innerWidth - tooltipW - 20, window.innerWidth - tooltipW - 24));
      }

      // Avoid collision with cursor pointer: if tooltip bounds cover current cursor hotspot, offset left
      if (
        this.currentPosition &&
        this.currentPosition.x >= leftPos - 12 &&
        this.currentPosition.x <= leftPos + tooltipW + 12 &&
        this.currentPosition.y >= topPos - 12 &&
        this.currentPosition.y <= topPos + tooltipH + 12
      ) {
        if (leftPos > window.innerWidth / 2) {
          leftPos = Math.max(16, leftPos - 60);
        } else {
          leftPos = Math.min(window.innerWidth - tooltipW - 16, leftPos + 60);
        }
      }

      this.tooltip.style.top = `${topPos}px`;
      this.tooltip.style.left = `${leftPos}px`;
      this.tooltip.style.opacity = '1';
      this.tooltip.style.transform = 'translateY(0)';
    } else {
      this.tooltip.style.opacity = '0';
    }
  }

  /**
   * Resolves landmark sections, headers, or containers down to their ACTUAL substantive component
   * (e.g., interactive tabs + code viewer, table, carousel, cards grid, form, sliders, or accordion)
   * NEVER highlights or lands on title headers, H1/H2 tags, or page section banners!
   */
  _resolveActualContent(el, explanation = '') {
    if (!el || !(el instanceof Element)) return el;

    const tag = el.tagName.toLowerCase();

    // 0. If el itself is a heading tag or title container, immediately find the actual substantive widget
    if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'header' || tag === 'nav' || el.classList.contains('pricing-header') || el.classList.contains('grid-fine')) {
      const parentScope = el.closest('section, main, article, div.space-y-24, div.space-y-12, div.space-y-8') || el.parentElement;
      if (parentScope && parentScope !== el) {
        const resolved = this._resolveActualContent(parentScope, explanation);
        if (resolved && resolved !== el) return resolved;
      }
      if (el.nextElementSibling) {
        const nextResolved = this._resolveActualContent(el.nextElementSibling, explanation);
        if (nextResolved) return nextResolved;
      }
    }

    const isSection = tag === 'section' || tag === 'article' || tag === 'main' || (el.id && el.id.includes('section'));
    if (!isSection) return el;

    // 1. Interactive Tabs / Framework Tabs / Workflow Tabs + Code/Content Viewer
    const tabWidget = el.querySelector('[role="tablist"], [data-tab-group]');
    if (tabWidget) {
      const tabsParent = tabWidget.closest('.space-y-6, .space-y-4, div:has(>[role="tablist"])') || tabWidget.parentElement;
      if (tabsParent && tabsParent !== el && !tabsParent.querySelector('h1, h2')) {
        return tabsParent;
      }
      return tabWidget;
    }

    // 2. Tables (e.g. 10-Tool API Reference Table, Latency Benchmark Table, Security Matrix, SLA)
    const tableContainer = el.querySelector('.overflow-x-auto, table');
    if (tableContainer) {
      return tableContainer;
    }

    // 3. Form (e.g. #contact-form)
    const form = el.querySelector('form');
    if (form) {
      return form;
    }

    // 4. Pricing Cards Grid / Feature Grid
    const cardsGrid = el.querySelector('#pricing-cards-grid, .pricing-grid, [data-plan="pro"], .grid:has(.pricing-card)');
    if (cardsGrid) {
      return cardsGrid;
    }

    // 5. Interactive Calculator Sliders & Result Card
    const calcGrid = el.querySelector('#roi-savings-calculator, .grid:has(input[type="range"]), .grid:has(#roi-result-card)');
    if (calcGrid) {
      return calcGrid;
    }

    // 6. Carousel / Case-Study Showcase
    const carousel = el.querySelector('[data-carousel], .carousel');
    if (carousel) {
      return carousel;
    }

    // 7. Telemetry / Metric strips
    const telemetryStrip = el.querySelector('#telemetry-strip, .grid:has(>div>div.text-2xl)');
    if (telemetryStrip) {
      return telemetryStrip;
    }

    // 8. Accordion / FAQ Details
    const faqContainer = el.querySelector('.space-y-3:has(details), details');
    if (faqContainer) {
      return faqContainer;
    }

    // 9. First substantive content following the title header block (unwrapping single relative z-10 containers)
    const contentScope = el.querySelector(':scope > .relative.z-10:not(.grid)') || el;
    const headerBlock = contentScope.querySelector(
      ':scope > div.mb-14:has(h1, h2), :scope > div.mb-16:has(h1, h2), :scope > div.space-y-2:has(h1), :scope > div.space-y-1:has(h2), :scope > div.space-y-4:has(h2), :scope > .pricing-header, :scope > header'
    );
    if (headerBlock && headerBlock.nextElementSibling) {
      return headerBlock.nextElementSibling;
    }

    return el;
  }

  _computeTargetCoordinates(el, rect, headerHeight, isInsideHeader) {
    const tag = el.tagName.toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();
    const isInteractiveControl =
      tag === 'button' ||
      tag === 'a' ||
      tag === 'input' ||
      tag === 'select' ||
      tag === 'textarea' ||
      tag === 'summary' ||
      role === 'button' ||
      role === 'tab' ||
      role === 'switch' ||
      role === 'link' ||
      (rect.width <= 340 && rect.height <= 95);

    if (isInteractiveControl) {
      return {
        x: Math.max(10, Math.min(window.innerWidth - 16, rect.left + rect.width / 2)),
        y: Math.max(10, Math.min(window.innerHeight - 16, rect.top + rect.height / 2))
      };
    }

    const activeTab = el.querySelector?.('[role="tab"][aria-selected="true"], [role="tab"].active, [role="tab"]');
    if (activeTab) {
      const tabRect = activeTab.getBoundingClientRect();
      return {
        x: Math.max(10, Math.min(window.innerWidth - 16, tabRect.left + tabRect.width / 2)),
        y: Math.max(10, Math.min(window.innerHeight - 16, tabRect.top + tabRect.height / 2))
      };
    }

    const activeSlide = el.querySelector?.('[data-carousel-slide]:not(.hidden), .carousel-slide:not(.hidden)');
    if (activeSlide) {
      const slideRect = activeSlide.getBoundingClientRect();
      return {
        x: Math.max(16, Math.min(window.innerWidth - 24, slideRect.left + Math.min(slideRect.width * 0.35, 200))),
        y: Math.max(headerHeight + 20, Math.min(window.innerHeight - 24, slideRect.top + Math.min(slideRect.height * 0.4, 80)))
      };
    }

    const proCard = el.querySelector?.('#plan-pro, [data-plan="pro"], .pricing-card:nth-child(3), .pricing-card');
    if (proCard) {
      const proRect = proCard.getBoundingClientRect();
      return {
        x: Math.max(16, Math.min(window.innerWidth - 24, proRect.left + proRect.width / 2)),
        y: Math.max(headerHeight + 20, Math.min(window.innerHeight - 24, proRect.top + Math.min(proRect.height * 0.35, 90)))
      };
    }

    const firstCell = el.querySelector?.('tbody tr:first-child td:first-child, thead th:first-child');
    if (firstCell) {
      const cellRect = firstCell.getBoundingClientRect();
      return {
        x: Math.max(16, Math.min(window.innerWidth - 24, cellRect.left + cellRect.width / 2)),
        y: Math.max(headerHeight + 20, Math.min(window.innerHeight - 24, cellRect.top + cellRect.height / 2))
      };
    }

    const minTop = isInsideHeader ? 12 : headerHeight + 22;
    const xOffset = Math.min(Math.max(48, rect.width * 0.35), 240);
    const yOffset = Math.min(Math.max(36, rect.height * 0.38), 95);

    return {
      x: Math.max(16, Math.min(window.innerWidth - 24, rect.left + xOffset)),
      y: Math.max(minTop, Math.min(window.innerHeight - 36, rect.top + yOffset))
    };
  }

  async moveToElement(selector, highlight = true, explanation = null) {
    const rawEl = this._resolve(selector);
    if (!rawEl) {
      console.warn(`[WebOrient] Element not found: ${selector}`);
      return { success: false, elementFound: false, error: `Element not found: ${selector}` };
    }

    const el = this._resolveActualContent(rawEl, explanation);

    const header = document.querySelector('#global-site-header, header, [data-site-header]');
    const isInsideHeader = header && header.contains(el);
    const headerHeight = header ? Math.round(header.getBoundingClientRect().height) : 70;
    const viewportHeight = window.innerHeight;
    const usableHeight = Math.max(200, viewportHeight - headerHeight);

    if (!isInsideHeader) {
      const initialRect = el.getBoundingClientRect();
      let targetTopInViewport;
      if (initialRect.height < usableHeight) {
        targetTopInViewport = headerHeight + Math.round((usableHeight - initialRect.height) / 2);
      } else {
        targetTopInViewport = headerHeight + 20;
      }

      const targetScrollY = Math.max(0, Math.round(window.scrollY + initialRect.top - targetTopInViewport));
      if (Math.abs(window.scrollY - targetScrollY) > 14) {
        await this._smoothScrollTo(targetScrollY);
      }
    }

    if (highlight) {
      this.activeTarget = el;
      this.activeExplanation = explanation || null;
      this._syncSpotlightPosition();
    }

    const settledRect = el.getBoundingClientRect();
    const { x: targetX, y: targetY } = this._computeTargetCoordinates(el, settledRect, headerHeight, isInsideHeader);

    await this.moveTo(targetX, targetY);

    if (highlight) {
      this._syncSpotlightPosition();
    }

    el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: targetX, clientY: targetY }));
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: targetX, clientY: targetY }));
    el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, clientX: targetX, clientY: targetY }));

    return {
      success: true,
      elementFound: true,
      element: el,
      selector: typeof selector === 'string' ? selector : (el.id ? `#${el.id}` : el.tagName.toLowerCase()),
      label: el.innerText?.trim()?.slice(0, 80) || el.getAttribute('aria-label') || null,
      explanation: explanation || null
    };
  }

  async guideTour(steps = []) {
    if (!Array.isArray(steps) || steps.length === 0) {
      return { success: false, error: 'No tour steps provided' };
    }

    this.cancelActiveActions();
    const controller = new AbortController();
    this._abortController = controller;
    const completedSteps = [];

    for (let i = 0; i < steps.length; i++) {
      if (controller.signal.aborted) break;
      const step = steps[i];
      const badgeText = `[0${i + 1}/0${steps.length}] ${step.explanation || 'Tour Stop'}`;
      const res = await this.moveToElement(step.selector, true, badgeText);

      const dwell = Math.min(4000, Math.max(600, step.dwellMs || 1200));
      await this._sleep(dwell);

      completedSteps.push({
        step: i + 1,
        selector: step.selector,
        success: res.success,
        explanation: step.explanation
      });
    }

    return {
      success: completedSteps.every(s => s.success),
      completedCount: completedSteps.length,
      steps: completedSteps
    };
  }

  async playClickAnimation() {
    const ring = this.cursor?.querySelector('.weborient-ring');
    const pointer = this.cursor?.querySelector('.weborient-pointer');
    if (ring) {
      ring.style.opacity = '1';
      ring.style.transform = 'scale(1.85)';
    }
    if (pointer) {
      pointer.style.transform = 'scale(0.86)';
    }
    await this._sleep(190);
    if (ring) {
      ring.style.opacity = '0';
      ring.style.transform = 'scale(0.5)';
    }
    if (pointer) {
      pointer.style.transform = 'scale(1)';
    }
  }

  async click(selector, explanation = null) {
    const el = this._resolve(selector);
    if (!el) {
      return { success: false, elementFound: false, error: `Element not found: ${selector}` };
    }

    const res = await this.moveToElement(el, true, explanation);
    if (!res.success) return res;

    await this.playClickAnimation();

    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const eventInit = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy };

    el.dispatchEvent(new PointerEvent('pointerdown', eventInit));
    el.dispatchEvent(new MouseEvent('mousedown', eventInit));
    if (typeof el.focus === 'function') el.focus({ preventScroll: true });
    el.dispatchEvent(new PointerEvent('pointerup', eventInit));
    el.dispatchEvent(new MouseEvent('mouseup', eventInit));
    el.click();

    this._syncSpotlightPosition();

    return {
      success: true,
      elementFound: true,
      action: 'click_element',
      selector: typeof selector === 'string' ? selector : (el.id ? `#${el.id}` : el.tagName.toLowerCase()),
      newState: {
        ariaExpanded: el.getAttribute('aria-expanded'),
        ariaSelected: el.getAttribute('aria-selected'),
        ariaChecked: el.getAttribute('aria-checked'),
        checked: el.checked ?? null
      }
    };
  }

  /**
   * Live-updates the floating coachmark badge text above the currently spotlighted component
   * so what the Ghost Cursor SHOWS on screen stays 100% synchronized with what the agent SAYS aloud.
   */
  updateActiveExplanation(explanation) {
    if (!explanation || !this.activeTarget || !document.body.contains(this.activeTarget)) return;
    this.activeExplanation = String(explanation).trim().slice(0, 140);
    this._syncSpotlightPosition();
  }

  async typeIntoField(selector, rawValue, charDelayMs = 22, explanation = null) {
    const el = this._resolve(selector);
    if (!el) {
      return { success: false, elementFound: false, error: `Form field not found: ${selector}` };
    }

    const normalizedValue = this._normalizeVoiceInput(el, rawValue);
    const badgeText = explanation || `${normalizedValue}`;
    const res = await this.moveToElement(el, true, badgeText);
    if (!res.success) return res;

    if (typeof el.focus === 'function') el.focus({ preventScroll: true });

    const tag = el.tagName.toLowerCase();
    const type = (el.type || '').toLowerCase();

    if (tag === 'select') {
      await this.playClickAnimation();
      const targetStr = String(normalizedValue).toLowerCase().trim();
      const matchedOption = Array.from(el.options).find(
        opt => opt.value.toLowerCase() === targetStr ||
               opt.text.toLowerCase().trim() === targetStr ||
               opt.text.toLowerCase().includes(targetStr)
      );
      const finalSelectValue = matchedOption ? matchedOption.value : normalizedValue;
      this._setNativeValue(el, finalSelectValue);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return this._buildFieldResult(el, selector);
    }

    if (type === 'checkbox' || type === 'radio') {
      await this.playClickAnimation();
      const shouldCheck = this._parseBooleanIntent(normalizedValue, !el.checked);
      if (el.checked !== shouldCheck) {
        el.click();
        if (el.checked !== shouldCheck) {
          el.checked = shouldCheck;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      return this._buildFieldResult(el, selector);
    }

    if (type === 'range') {
      const min = parseFloat(el.min || '0');
      const max = parseFloat(el.max || '100');
      const numVal = parseFloat(String(normalizedValue).replace(/[^0-9.-]/g, ''));
      const clampedVal = Number.isFinite(numVal) ? Math.max(min, Math.min(max, numVal)) : min;

      const rect = el.getBoundingClientRect();
      const ratio = max > min ? (clampedVal - min) / (max - min) : 0.5;
      const thumbX = rect.left + Math.max(8, Math.min(rect.width - 8, rect.width * ratio));
      const thumbY = rect.top + rect.height / 2;

      await this.moveTo(thumbX, thumbY, 280);
      await this.playClickAnimation();

      this._setNativeValue(el, String(clampedVal));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return this._buildFieldResult(el, selector);
    }

    const textToType = String(normalizedValue);
    this._setNativeValue(el, '');
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));

    const delay = textToType.length > 40 ? Math.min(10, charDelayMs) : charDelayMs;
    let currentStr = '';

    for (const char of textToType) {
      currentStr += char;
      this._setNativeValue(el, currentStr);
      el.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        data: char,
        inputType: 'insertText'
      }));
      if (delay > 0) {
        await this._sleep(delay);
      }
    }

    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new FocusEvent('blur', { bubbles: true }));

    return this._buildFieldResult(el, selector);
  }

  async fillFormBatch(fields = [], explanation = null) {
    if (!Array.isArray(fields) || fields.length === 0) {
      return { success: false, error: 'No fields provided for batch fill' };
    }

    const results = [];
    for (const item of fields) {
      if (!item || !item.selector) continue;
      const res = await this.typeIntoField(item.selector, item.value ?? '', 12, item.explanation || explanation || null);
      results.push(res);
    }

    const invalidFields = results.filter(r => r.valid === false);
    return {
      success: results.every(r => r.success),
      filledCount: results.filter(r => r.success).length,
      allValid: invalidFields.length === 0,
      invalidFields,
      fields: results
    };
  }

  async scroll(direction = 'down', targetSelector = null, amount = 'page', explanation = null) {
    if (targetSelector) {
      const targetEl = this._resolve(targetSelector);
      if (targetEl) {
        return await this.moveToElement(targetEl, true, explanation || null);
      }
    }

    const dir = String(direction || 'down').toLowerCase();
    const distanceRatio = amount === 'small' ? 0.35 : (amount === 'half' ? 0.5 : 0.75);
    const scrollAmount = Math.round(window.innerHeight * distanceRatio);

    let nextScrollY = window.scrollY;
    if (dir === 'top') {
      nextScrollY = 0;
    } else if (dir === 'bottom') {
      nextScrollY = document.documentElement.scrollHeight - window.innerHeight;
    } else if (dir === 'up') {
      nextScrollY = Math.max(0, window.scrollY - scrollAmount);
    } else {
      nextScrollY = window.scrollY + scrollAmount;
    }

    await this._smoothScrollTo(nextScrollY);
    this._syncSpotlightPosition();

    return {
      success: true,
      action: 'scroll_page',
      direction: dir,
      scrollY: Math.round(window.scrollY)
    };
  }

  async swipeOrSwap(selector, action = 'next', targetValue = null, explanation = null) {
    let el = this._resolve(selector);
    if (!el) {
      return { success: false, elementFound: false, error: `Target widget not found: ${selector}` };
    }

    const act = String(action || 'next').toLowerCase();

    // 1. Range Slider
    const rangeInput = (el.tagName === 'INPUT' && el.type === 'range')
      ? el
      : el.querySelector?.('input[type="range"]');
    if (rangeInput && (el.tagName === 'INPUT' || act === 'slide' || targetValue !== null)) {
      const min = parseFloat(rangeInput.min || '0');
      const max = parseFloat(rangeInput.max || '100');
      const current = parseFloat(rangeInput.value || '0');
      const step = parseFloat(rangeInput.step || '1') || Math.max(1, (max - min) * 0.1);
      let nextVal = current;

      if (targetValue !== null && targetValue !== undefined && targetValue !== '') {
        nextVal = parseFloat(String(targetValue).replace(/[^0-9.-]/g, ''));
      } else if (act === 'next' || act === 'right' || act === 'increase') {
        nextVal = Math.min(max, current + step * 5);
      } else if (act === 'prev' || act === 'left' || act === 'decrease') {
        nextVal = Math.max(min, current - step * 5);
      }
      return await this.typeIntoField(rangeInput, String(nextVal), 22, explanation);
    }

    // 2. Toggle Switch or Checkbox
    const switchEl = (el.getAttribute('role') === 'switch' || (el.tagName === 'INPUT' && el.type === 'checkbox'))
      ? el
      : el.querySelector?.('[role="switch"], input[type="checkbox"]');
    if (switchEl && (el === switchEl || act === 'toggle' || act === 'switch')) {
      return await this.click(switchEl, explanation || null);
    }

    // 3. Tablist / Tabs
    if (
      el.getAttribute('role') === 'tablist' ||
      el.getAttribute('role') === 'tab' ||
      el.hasAttribute('data-tab') ||
      el.querySelector('[role="tab"], [data-tab]')
    ) {
      const tabContainer = (el.getAttribute('role') === 'tab' || el.hasAttribute('data-tab'))
        ? (el.closest('[role="tablist"]') || el.parentElement)
        : (el.querySelector('[role="tablist"]') || el);
      const tabs = Array.from(tabContainer.querySelectorAll('[role="tab"], [data-tab]'));

      let targetTab = (el.getAttribute('role') === 'tab' || el.hasAttribute('data-tab')) ? el : null;
      if (targetValue) {
        const needle = String(targetValue).toLowerCase().trim();
        targetTab = tabs.find(t =>
          (t.getAttribute('data-tab') || '').toLowerCase() === needle ||
          t.innerText.toLowerCase().includes(needle)
        ) || targetTab;
      } else if (!targetTab && tabs.length > 0) {
        const activeIdx = Math.max(0, tabs.findIndex(
          t => t.getAttribute('aria-selected') === 'true' || t.classList.contains('active')
        ));
        const delta = (act === 'prev' || act === 'left') ? -1 : 1;
        const nextIdx = (activeIdx + delta + tabs.length) % tabs.length;
        targetTab = tabs[nextIdx];
      }

      if (targetTab) {
        await this.click(targetTab, explanation || targetTab.innerText.trim());
        return {
          success: true,
          action: 'swipe_or_swap',
          widgetType: 'tabs',
          activeTab: targetTab.innerText.trim() || targetTab.getAttribute('data-tab')
        };
      }
    }

    // 4. Carousel / Swipeable Container
    const carouselBox = el.hasAttribute('data-carousel')
      ? el
      : (el.querySelector('[data-carousel]') || el);

    await this.moveToElement(carouselBox, true, explanation || null);
    const rect = carouselBox.getBoundingClientRect();
    const cy = Math.max(24, Math.min(window.innerHeight - 24, rect.top + rect.height * 0.5));
    const isNext = act !== 'prev' && act !== 'right';
    const startX = isNext ? rect.left + rect.width * 0.76 : rect.left + rect.width * 0.24;
    const endX = isNext ? rect.left + rect.width * 0.24 : rect.left + rect.width * 0.76;

    await this._animateSwipeGesture(carouselBox, startX, cy, endX, cy);

    const searchScope = carouselBox.closest('section') || carouselBox.parentElement || document;
    const btnSelector = isNext
      ? '[data-carousel-next], .carousel-next, [aria-label*="Next" i]'
      : '[data-carousel-prev], .carousel-prev, [aria-label*="Prev" i]';
    const navBtn = carouselBox.querySelector(btnSelector) || searchScope.querySelector(btnSelector);

    if (targetValue !== null && targetValue !== undefined && targetValue !== '') {
      const idx = parseInt(targetValue, 10);
      const indicator = searchScope.querySelector(`[data-slide-to="${idx}"]`);
      if (indicator) indicator.click();
    } else if (navBtn) {
      navBtn.click();
    }

    this._syncSpotlightPosition();

    const slides = Array.from(carouselBox.querySelectorAll('[data-carousel-slide], .carousel-slide'));
    const activeSlide = slides.find(s => !s.classList.contains('hidden') && s.getAttribute('aria-hidden') !== 'true');

    return {
      success: true,
      action: 'swipe_or_swap',
      widgetType: 'carousel',
      direction: act,
      activeSlideText: activeSlide ? activeSlide.innerText.replace(/\s+/g, ' ').trim().slice(0, 140) : null
    };
  }

  async _animateSwipeGesture(el, startX, startY, endX, endY) {
    await this.moveTo(startX, startY, 240);

    if (this.trailPath) {
      this.trailPath.setAttribute('d', `M ${startX} ${startY} Q ${(startX + endX) / 2} ${startY - 24} ${endX} ${endY}`);
      this.trailPath.style.opacity = '0.95';
    }

    const pointer = this.cursor?.querySelector('.weborient-pointer');
    if (pointer) pointer.style.transform = 'scale(0.9)';

    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: startX, clientY: startY }));
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: startX, clientY: startY }));

    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const cx = startX + (endX - startX) * t;
      const cy = startY + (endY - startY) * t;
      el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: cx, clientY: cy }));
      el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: cx, clientY: cy }));
    }

    await this.moveTo(endX, endY, 320);

    if (pointer) pointer.style.transform = 'scale(1)';

    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: endX, clientY: endY }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: endX, clientY: endY }));

    if (this.trailPath) {
      setTimeout(() => {
        if (this.trailPath) this.trailPath.style.opacity = '0';
      }, 380);
    }
  }

  _setNativeValue(el, value) {
    if (el.isContentEditable) {
      el.innerText = value;
      return;
    }
    const proto = el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement?.prototype
      : (el.tagName === 'SELECT' ? window.HTMLSelectElement?.prototype : window.HTMLInputElement?.prototype);
    const descriptor = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : null;
    if (descriptor && typeof descriptor.set === 'function') {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }
  }

  _normalizeVoiceInput(el, rawValue) {
    if (rawValue === null || rawValue === undefined) return '';
    let val = String(rawValue).trim();
    const type = (el.type || '').toLowerCase();
    const nameOrId = `${el.name || ''} ${el.id || ''}`.toLowerCase();

    if (type === 'email' || nameOrId.includes('email')) {
      val = val
        .replace(/\s+at\s+/gi, '@')
        .replace(/\s+dot\s+/gi, '.')
        .replace(/\s+underscore\s+/gi, '_')
        .replace(/\s+dash\s+|\s+hyphen\s+/gi, '-')
        .replace(/\s+/g, '')
        .toLowerCase();
    } else if (type === 'tel' || nameOrId.includes('phone')) {
      val = val.replace(/[^\d+()\-\s]/g, '').trim();
    }

    return val;
  }

  _parseBooleanIntent(val, fallback) {
    if (typeof val === 'boolean') return val;
    const s = String(val).toLowerCase().trim();
    if (['true', 'yes', '1', 'check', 'checked', 'on', 'enable', 'enabled'].includes(s)) return true;
    if (['false', 'no', '0', 'uncheck', 'unchecked', 'off', 'disable', 'disabled'].includes(s)) return false;
    return fallback;
  }

  _buildFieldResult(el, selector) {
    const valid = typeof el.checkValidity === 'function' ? el.checkValidity() : true;
    const validationMessage = el.validationMessage || null;
    return {
      success: true,
      elementFound: true,
      action: 'fill_form_field',
      selector: typeof selector === 'string' ? selector : (el.id ? `#${el.id}` : el.tagName.toLowerCase()),
      currentValue: el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value,
      valid,
      validationMessage
    };
  }

  cancelActiveActions() {
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    if (this._moveCancelResolve) {
      const r = this._moveCancelResolve;
      this._moveCancelResolve = null;
      r();
    }
    this.hideSpeechBubble();
    this.isMoving = false;
  }

  hideSpotlight() {
    this.activeTarget = null;
    this.activeExplanation = null;
    if (this.spotlight) {
      this.spotlight.style.opacity = '0';
    }
    if (this.tooltip) {
      this.tooltip.style.opacity = '0';
    }
  }

  destroy() {
    this.cancelActiveActions();
    if (this._boundSyncPosition) {
      window.removeEventListener('scroll', this._boundSyncPosition, { capture: true });
      window.removeEventListener('resize', this._boundSyncPosition);
    }
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
  }

  _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  _escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}


// --- MODULE: live-client.js ---
/**
 * WebOrient Live Client (v0.6.0 — Zero-Lag Audio-Visual Sync & Auto-Resume Playback)
 * - Captures 16kHz mono PCM microphone audio (AudioWorklet with ScriptProcessor fallback)
 * - Decodes and plays 24kHz Int16 PCM model audio streams gaplessly via Web Audio API
 * - Automatic AudioContext state recovery (`resume()`) across SPA route changes & clicks
 * - Batched `functionCalls` -> `functionResponses` delivery so multi-tool callbacks never stall audio
 */
class LiveClient {
  constructor(options = {}) {
    this.endpoint =
      options.endpoint ||
      (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
        ? 'ws://localhost:8088'
        : 'wss://relay.deploymate.in');
    this.onToolCall = options.onToolCall || (() => {});
    this.onStatusChange = options.onStatusChange || (() => {});
    this.onTranscript = options.onTranscript || (() => {});
    this.onPlaybackChange = options.onPlaybackChange || (() => {});
    this.onInterrupted = options.onInterrupted || (() => {});

    this.ws = null;
    this.captureContext = null;
    this.playbackContext = null;
    this.mediaStream = null;
    this.workletNode = null;
    this.scriptProcessor = null;

    this.activeSourceNodes = new Set();
    this.nextPlayTime = 0;
    this.isPlaying = false;
  }

  async connect() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    this.captureContext = new AudioCtx({ sampleRate: 16000 });
    this.playbackContext = new AudioCtx({ sampleRate: 24000 });

    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    return new Promise((resolve, reject) => {
      let settled = false;
      this.ws = new WebSocket(this.endpoint);

      this.ws.onopen = async () => {
        settled = true;
        this.onStatusChange('connected');
        await this._startAudioStreaming();
        resolve();
      };

      this.ws.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          this._handleServerMessage(data);
        } catch (err) {
          console.error('[WebOrient] Failed to parse server frame:', err);
        }
      };

      this.ws.onclose = () => {
        this.onStatusChange('disconnected');
        this.stop();
      };

      this.ws.onerror = (err) => {
        console.error('[WebOrient] WebSocket error:', err);
        this.onStatusChange('error');
        if (!settled) {
          settled = true;
          reject(new Error(`WebSocket connection failed to ${this.endpoint}`));
        }
      };
    });
  }

  async _startAudioStreaming() {
    if (!this.captureContext || !this.mediaStream) return;
    if (this.captureContext.state === 'suspended') {
      await this.captureContext.resume();
    }
    if (this.playbackContext && this.playbackContext.state === 'suspended') {
      await this.playbackContext.resume();
    }

    const source = this.captureContext.createMediaStreamSource(this.mediaStream);
    const zeroGain = this.captureContext.createGain();
    zeroGain.gain.value = 0;
    zeroGain.connect(this.captureContext.destination);

    if (this.captureContext.audioWorklet) {
      try {
        const workletCode = `
          class WebOrientPCMProcessor extends AudioWorkletProcessor {
            constructor() {
              super();
              this.buffer = new Float32Array(2048);
              this.offset = 0;
            }
            process(inputs) {
              const input = inputs[0];
              if (!input || !input[0]) return true;
              const channel = input[0];
              for (let i = 0; i < channel.length; i++) {
                this.buffer[this.offset++] = channel[i];
                if (this.offset >= this.buffer.length) {
                  this.port.postMessage(this.buffer.slice(0));
                  this.offset = 0;
                }
              }
              return true;
            }
          }
          registerProcessor('weborient-pcm-processor', WebOrientPCMProcessor);
        `;
        const blob = new Blob([workletCode], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        await this.captureContext.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);

        this.workletNode = new AudioWorkletNode(this.captureContext, 'weborient-pcm-processor');
        this.workletNode.port.onmessage = (e) => {
          this._sendFloat32AudioFrame(e.data);
        };
        source.connect(this.workletNode);
        this.workletNode.connect(zeroGain);
        return;
      } catch (err) {
        console.warn('[WebOrient] AudioWorklet fallback to ScriptProcessor:', err);
      }
    }

    this.scriptProcessor = this.captureContext.createScriptProcessor(4096, 1, 1);
    this.scriptProcessor.onaudioprocess = (e) => {
      const inputData = e.inputBuffer.getChannelData(0);
      this._sendFloat32AudioFrame(inputData);
    };
    source.connect(this.scriptProcessor);
    this.scriptProcessor.connect(zeroGain);
  }

  _sendFloat32AudioFrame(float32Array) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const pcm16 = this._floatTo16BitPCM(float32Array);
    const base64 = this._arrayBufferToBase64(pcm16.buffer);

    this.ws.send(JSON.stringify({
      realtimeInput: {
        mediaChunks: [{ mimeType: 'audio/pcm;rate=16000', data: base64 }]
      }
    }));
  }

  _handleServerMessage(msg) {
    // 1. Handle user barge-in interruption
    if (msg.serverContent?.interrupted) {
      this._clearAudioQueue();
      this.onInterrupted();
      return;
    }

    // 2. Forward user speech transcription (`inputTranscription`) for language detection & memory
    if (msg.serverContent?.inputTranscription?.text) {
      this.onTranscript(msg.serverContent.inputTranscription.text, 'user');
    }

    // 3. Play incoming 24kHz PCM audio chunks & forward model transcripts
    if (msg.serverContent?.modelTurn?.parts) {
      for (const part of msg.serverContent.modelTurn.parts) {
        if (part.inlineData && part.inlineData.mimeType?.startsWith('audio/pcm')) {
          this._scheduleAudioChunk(part.inlineData.data, 24000);
        }
        if (part.text) {
          this.onTranscript(part.text, 'model');
        }
      }
    }

    if (msg.serverContent?.outputTranscription?.text) {
      this.onTranscript(msg.serverContent.outputTranscription.text, 'model');
    }

    // 4. Handle model tool calls (pass full array so multi-call batches are answered together in <40ms)
    if (msg.toolCall?.functionCalls && msg.toolCall.functionCalls.length > 0) {
      this.onToolCall(msg.toolCall.functionCalls);
    }
  }

  async _scheduleAudioChunk(base64Audio, sampleRate = 24000) {
    if (!this.playbackContext || !base64Audio) return;
    if (this.playbackContext.state === 'suspended') {
      try { await this.playbackContext.resume(); } catch (_) {}
    }

    const int16 = this._base64ToInt16Array(base64Audio);
    if (int16.length === 0) return;

    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768.0;
    }

    const audioBuffer = this.playbackContext.createBuffer(1, float32.length, sampleRate);
    audioBuffer.getChannelData(0).set(float32);

    const sourceNode = this.playbackContext.createBufferSource();
    sourceNode.buffer = audioBuffer;
    sourceNode.connect(this.playbackContext.destination);

    const now = this.playbackContext.currentTime;
    const startAt = Math.max(now + 0.01, this.nextPlayTime);
    sourceNode.start(startAt);
    this.nextPlayTime = startAt + audioBuffer.duration;

    if (!this.isPlaying) {
      this.isPlaying = true;
      this.onPlaybackChange(true);
    }

    this.activeSourceNodes.add(sourceNode);
    sourceNode.onended = () => {
      this.activeSourceNodes.delete(sourceNode);
      if (this.activeSourceNodes.size === 0) {
        this.isPlaying = false;
        this.onPlaybackChange(false);
      }
    };
  }

  _clearAudioQueue() {
    for (const node of this.activeSourceNodes) {
      try {
        node.stop(0);
        node.disconnect();
      } catch (_) {}
    }
    this.activeSourceNodes.clear();
    if (this.playbackContext) {
      this.nextPlayTime = this.playbackContext.currentTime;
    }
    if (this.isPlaying) {
      this.isPlaying = false;
      this.onPlaybackChange(false);
    }
  }

  sendToolResponse(callIdOrResponses, toolName, output) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const functionResponses = Array.isArray(callIdOrResponses)
      ? callIdOrResponses
      : [
          {
            id: callIdOrResponses,
            name: toolName || 'tool_result',
            response: { output }
          }
        ];

    this.ws.send(JSON.stringify({
      toolResponse: { functionResponses }
    }));
  }

  sendText(text, options = {}) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && text) {
      const turnComplete = options.turnComplete !== undefined ? Boolean(options.turnComplete) : true;
      this.ws.send(JSON.stringify({ text: String(text), turnComplete }));
    }
  }

  _floatTo16BitPCM(input) {
    const output = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return output;
  }

  _arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  _base64ToInt16Array(base64) {
    const binary = window.atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Int16Array(bytes.buffer);
  }

  stop() {
    this._clearAudioQueue();
    if (this.workletNode) {
      try { this.workletNode.disconnect(); } catch (_) {}
      this.workletNode = null;
    }
    if (this.scriptProcessor) {
      try { this.scriptProcessor.disconnect(); } catch (_) {}
      this.scriptProcessor = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(t => t.stop());
      this.mediaStream = null;
    }
    if (this.captureContext) {
      this.captureContext.close().catch(() => {});
      this.captureContext = null;
    }
    if (this.playbackContext) {
      this.playbackContext.close().catch(() => {});
      this.playbackContext = null;
    }
    if (this.ws) {
      try { this.ws.close(); } catch (_) {}
      this.ws = null;
    }
  }
}


// --- MODULE: weborient.js ---
/**
 * WebOrient by DeployMate: Multi-Tenant Voice Co-Pilot & Shadow DOM SDK (`src/sdk/weborient.js` v0.6.0)
 * - 1-Line Embed Ready (`<script async src="..." data-site-key="wo_live_..." data-theme="signal" data-lang="en-IN">`)
 * - Full-Page, Popup, Modal, Drawer, Banner & Close-Button (`X`) Auto-Indexing via Live `MutationObserver`
 * - Strict Showing-vs-Saying Language Synchronization:
 *   Detects & locks user language (`en-IN`, `hinglish`, `hi-IN`, `es-ES`, `fr-FR`), records persistent
 *   agent notes, updates the Shadow DOM language badge, and synchronizes the floating Ghost Cursor
 *   coachmark badge (`explanation`) with the exact language and phrasing the agent is speaking!
 */




const THEME_PRESETS = {
  signal: { primaryColor: '#E6391E', accentColor: '#0A0A0A' },
  deploymate: { primaryColor: '#E6391E', accentColor: '#0A0A0A' },
  indigo: { primaryColor: '#6366f1', accentColor: '#ec4899' }
};

function getDefaultRelayEndpoint() {
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      return 'ws://localhost:8088';
    }
  }
  return 'wss://relay.deploymate.in';
}

class WebOrient {
  constructor(options = {}) {
    const preset = THEME_PRESETS[options.theme] || THEME_PRESETS.signal;

    this.options = Object.assign({
      endpoint: getDefaultRelayEndpoint(),
      siteKey: 'wo_live_deploymate_demo',
      siteId: 'deploymate_weborient',
      themeColor: preset.primaryColor,
      accentColor: preset.accentColor,
      cursorStyle: 'deploymate-signal',
      defaultLanguage: null,
      manifestUrl: null,
      requireSubmitConfirmation: false,
      autoMountLauncher: false,
      onEvent: null
    }, options);

    this.scanner = new DOMScanner();
    this.cursor = new GhostCursor({
      primaryColor: this.options.themeColor,
      accentColor: this.options.accentColor,
      cursorStyle: this.options.cursorStyle,
      scanner: this.scanner
    });

    this.memory = new SessionMemory({
      siteKey: this.options.siteKey,
      endpoint: this.options.endpoint,
      defaultLanguage: this.options.defaultLanguage,
      onChange: (memState) => {
        queueMicrotask(() => this._emit('memoryUpdate', memState));
      },
      onLanguageChange: (langCfg, prevLang) => {
        this._handleLanguageChange(langCfg, prevLang);
      }
    });

    if (this.options.defaultLanguage && !this.memory.state.languageLocked) {
      this.memory.setLanguage(this.options.defaultLanguage, false, 'script data-lang attribute');
    }

    this.client = null;
    this.manifest = null;
    this.remainingCredits = null;
    this._modelSpeechBuffer = '';
    this._lastAutoGroundedSelector = null;
    this._lastExplicitToolTime = 0;
    this._isExecutingTool = false;
    this._domObserver = null;
    this._lastPopupSignature = '';
    this._lastObservedRoute = '';

    if (typeof window !== 'undefined') {
      const currentFile = window.location.pathname.split('/').pop() || window.location.pathname || '/';
      this.memory.recordPageVisit(currentFile);
      this._prewarmRelay();
      this._startLiveDomObserver();
    }

    this._manifestReadyPromise = this.options.manifestUrl
      ? this.loadManifest(this.options.manifestUrl)
      : Promise.resolve(null);

    if (this.options.autoMountLauncher && typeof document !== 'undefined') {
      this._mountShadowAssistWidget();
    }

    if (typeof window !== 'undefined') {
      setTimeout(() => {
        this.memory.syncDynamicDomChecklist(this.scanner, this.manifest);
      }, 650);
    }

    this._checkRestoredSession();
  }

  _prewarmRelay() {
    try {
      const wsEndpoint = this.options.endpoint || getDefaultRelayEndpoint();
      const httpHealthUrl = wsEndpoint.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:').replace(/\/+$/, '') + '/health';
      fetch(httpHealthUrl, { mode: 'no-cors', cache: 'no-store' }).catch(() => {});
    } catch (_) {}
  }

  /**
   * Watches the host website for dynamically opened popups, modals, drawers, banners,
   * lazy-loaded React routes (`React.lazy` + Framer Motion), and `history.pushState`/`replaceState`
   * transitions so newly rendered buttons (like 'Sound on' / 'Keep it silent' on `/contact`)
   * and Close ('X') buttons are indexed automatically!
   */
  _startLiveDomObserver() {
    if (typeof window === 'undefined' || typeof MutationObserver === 'undefined') return;

    let debounceTimer = null;
    const checkDomDelta = () => {
      this.memory.syncDynamicDomChecklist(this.scanner, this.manifest);
      const currentRoute = window.location.pathname + window.location.hash;
      const activePopups = this.scanner.scanActiveOverlaysAndPopups();
      const visibleControls = this.scanner.scan({ includeOffscreen: false }).slice(0, 65);

      const popupSig = activePopups.map(p => `${p.selector}:${p.closeButtonSelector || ''}:${p.controls?.length || 0}`).join('|');
      const controlSig = visibleControls.slice(0, 20).map(c => `${c.selector}:${c.label}`).join('|');

      const routeChanged = this._lastObservedRoute && this._lastObservedRoute !== currentRoute;
      const popupChanged = popupSig !== this._lastPopupSignature;
      const controlsChangedOnNewRoute = controlSig !== this._lastControlSignature && (routeChanged || activePopups.length > 0 || currentRoute !== '/');

      this._lastObservedRoute = currentRoute;
      this._lastPopupSignature = popupSig;
      this._lastControlSignature = controlSig;

      if (this.client && (popupChanged || routeChanged || controlsChangedOnNewRoute)) {
        const pageContent = this.scanner.readPageContent({ manifest: this.manifest });
        const updateMsg = [
          `[SILENT BACKGROUND DOM & POPUP INDEX UPDATE — Route: ${currentRoute} (Do NOT reply aloud to this background update)]`,
          activePopups.length > 0
            ? `ACTIVE OVERLAYS / POPUPS / STAGE SCREENS ON SCREEN (Including 'Sound on', 'Keep it silent', and Close 'X' Buttons): ${JSON.stringify(activePopups)}`
            : `No modal/popup currently open.`,
          `Current Page Sections / Stage Text: ${JSON.stringify((pageContent.matchingSections || []).map(s => ({ selector: s.selector, heading: s.heading, summary: (s.summary || '').slice(0, 200) })))}`,
          `Visible Interactive Controls & Buttons on Screen: ${JSON.stringify(visibleControls.map(e => ({ selector: e.selector, label: e.label, tag: e.tag, type: e.type, isCloseButton: e.isCloseButton || false })))}`
        ].join('\n');
        this.client.sendText(updateMsg, { turnComplete: false });
      }
    };

    const scheduleCheck = (delayMs = 320) => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(checkDomDelta, delayMs);
    };

    const triggerMultiStageRouteScan = () => {
      scheduleCheck(120);
      setTimeout(checkDomDelta, 520);
      setTimeout(checkDomDelta, 1050);
    };

    // Hook history.pushState & history.replaceState so React Router / Next.js SPA navigations are always caught
    if (!window.__weborientHistoryHooked) {
      window.__weborientHistoryHooked = true;
      const origPushState = window.history.pushState;
      const origReplaceState = window.history.replaceState;
      window.history.pushState = function (...args) {
        const res = origPushState.apply(this, args);
        window.dispatchEvent(new CustomEvent('weborient:routechange'));
        return res;
      };
      window.history.replaceState = function (...args) {
        const res = origReplaceState.apply(this, args);
        window.dispatchEvent(new CustomEvent('weborient:routechange'));
        return res;
      };
    }

    const attachObserver = () => {
      if (!document.body || this._domObserver) return;
      this._lastObservedRoute = window.location.pathname + window.location.hash;
      this._domObserver = new MutationObserver((mutations) => {
        const relevant = mutations.some(m => {
          if (m.target && (m.target.id === 'weborient-shadow-host' || m.target.closest?.('#weborient-shadow-host'))) {
            return false;
          }
          return m.addedNodes.length > 0 || m.removedNodes.length > 0 || m.type === 'attributes';
        });
        if (relevant) scheduleCheck(320);
      });
      this._domObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'aria-expanded', 'aria-hidden', 'open']
      });
    };

    if (document.body) {
      attachObserver();
    } else {
      window.addEventListener('DOMContentLoaded', attachObserver, { once: true });
    }

    window.addEventListener('weborient:routechange', triggerMultiStageRouteScan);
    window.addEventListener('popstate', triggerMultiStageRouteScan);
    window.addEventListener('hashchange', triggerMultiStageRouteScan);
  }

  /**
   * Synchronizes UI language badge and broadcasts an immediate language lock directive
   * to the active Gemini Live session whenever user language is detected or changed.
   */
  _handleLanguageChange(langCfg, prevLang) {
    const shadowRoot = this.cursor?.shadowRoot;
    if (shadowRoot) {
      const langSelect = shadowRoot.getElementById('wo-shadow-lang-select');
      const langBadge = shadowRoot.getElementById('wo-shadow-lang-badge');
      if (langSelect && langSelect.value !== langCfg.code) {
        langSelect.value = langCfg.code;
      }
      if (langBadge) {
        langBadge.textContent = langCfg.badge || langCfg.code.toUpperCase();
      }
    }

    const lightSelect = document.getElementById('quick-lang-select');
    if (lightSelect && lightSelect.value !== langCfg.code) {
      lightSelect.value = langCfg.code;
    }

    // Silent language handling: language change is tracked in session memory and tool responses;
    // do not send text prompts here so the model does not announce language switches aloud.

    this._emit('languageChange', langCfg);
  }

  _extractLiveSiteMetadata() {
    if (typeof document === 'undefined') return '';
    const parts = [];
    const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute('content');
    if (metaDesc) {
      parts.push(`Meta Description: ${metaDesc.trim()}`);
    }
    const ldScripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    for (const s of ldScripts.slice(0, 3)) {
      try {
        const raw = (s.textContent || '').replace(/\s+/g, ' ').trim();
        if (raw) parts.push(`JSON-LD Structured Data: ${raw.slice(0, 1400)}`);
      } catch (_) {}
    }
    return parts.join('\n');
  }

  async loadManifest(url) {
    try {
      const res = await fetch(url);
      this.manifest = await res.json();
      console.log('[WebOrient] Loaded site manifest:', this.manifest.siteName);
      this.memory.syncDynamicDomChecklist(this.scanner, this.manifest);
      return this.manifest;
    } catch (e) {
      console.warn('[WebOrient] Failed to load manifest:', e);
      return null;
    }
  }

  /**
   * Connects microphone audio to the DeployMate Multi-Tenant Relay & Gemini Live Model
   */
  async start(options = {}) {
    const endpoint = this.options.endpoint || this.memory.state.liveEndpoint || getDefaultRelayEndpoint();
    this.options.endpoint = endpoint;

    const sep = endpoint.includes('?') ? '&' : '?';
    const wsUrl =
      `${endpoint}${sep}` +
      `siteKey=${encodeURIComponent(this.options.siteKey)}` +
      `&siteId=${encodeURIComponent(this.options.siteId)}` +
      `&sessionId=${encodeURIComponent(this.memory.state.sessionId)}` +
      `&lang=${encodeURIComponent(this.memory.state.userLanguage || this.options.defaultLanguage || 'en-IN')}`;

    this.client = new LiveClient({
      endpoint: wsUrl,
      onToolCall: (callsOrName, args, callId) => {
        if (Array.isArray(callsOrName)) {
          return this.handleToolCallBatch(callsOrName);
        }
        return this.handleToolCall(callsOrName, args, callId);
      },
      onStatusChange: (status) => {
        console.log(`[WebOrient] Status: ${status}`);
        this._syncShadowWidgetState(status === 'connected', 'idle');
        this._emit('status', { status });
      },
      onTranscript: (text, role) => {
        this.memory.appendTranscript(role, text);
        if (role === 'model') {
          this._autoGroundFromModelSpeech(text);
        }
        this._syncShadowWidgetState(true, role === 'model' ? 'speaking' : 'listening');
        this._emit('transcript', { text, role });
      },
      onPlaybackChange: (isPlaying) => {
        if (!isPlaying) {
          this._modelSpeechBuffer = '';
          this._syncShadowWidgetState(Boolean(this.client), 'listening');
        } else {
          this._syncShadowWidgetState(true, 'speaking');
        }
      },
      onInterrupted: () => {
        this._modelSpeechBuffer = '';
        this.cursor.cancelActiveActions();
        this._syncShadowWidgetState(true, 'listening');
        this._emit('interrupted', {});
      }
    });

    await this.client.connect();
    this.memory.setLiveSessionStatus(true, endpoint);
    this._syncShadowWidgetState(true, 'listening');

    this.memory.syncDynamicDomChecklist(this.scanner, this.manifest);
    const initialSnapshot = this.scanner.captureStateSnapshot();
    const initialElements = this.scanner.scan({ includeOffscreen: true }).slice(0, 110);
    const activePopups = this.scanner.scanActiveOverlaysAndPopups();
    const discoveredRoutes = this.scanner.discoverSiteRoutes();
    const pageContent = this.scanner.readPageContent({ manifest: this.manifest });
    const liveMetadata = this._extractLiveSiteMetadata();
    const memorySummary = this.memory.buildModelContextSummary();
    const isRestore = Boolean(options.isRestore) && this.memory.state.recentTranscripts.length > 0;

    const handoffPayload =
      `[SESSION CONTINUITY & FULL DOM INDEX HANDOFF]\n${memorySummary}\n` +
      (liveMetadata ? `[CLIENT WEBSITE METADATA & FAQ]:\n${liveMetadata}\n` : '') +
      `[DISCOVERED SITE PAGES, ANCHORS & SPA NAVIGATION TRIGGERS]:\n${JSON.stringify(discoveredRoutes)}\n` +
      (activePopups.length > 0 ? `[ACTIVE POPUPS / MODALS / DRAWERS ON SCREEN]:\n${JSON.stringify(activePopups)}\n` : '') +
      `[CURRENT PAGE SECTIONS ("${document.title}" - ${initialSnapshot.url})]:\n` +
      `${JSON.stringify((pageContent.matchingSections || []).map(s => ({ selector: s.selector, heading: s.heading, summary: (s.summary || '').slice(0, 180) })))}\n` +
      `[ALL INDEXED BUTTONS, INPUTS, BANNERS & CLOSE ('X') CONTROLS ON PAGE (${initialElements.length} items)]:\n` +
      `${JSON.stringify(initialElements.map(e => ({ selector: e.selector, label: e.label, tag: e.tag, type: e.type, section: e.section, isCloseButton: e.isCloseButton || false })))}` +
      (isRestore
        ? ''
        : `\n\n[SESSION START — SPEAK FIRST NOW]: A visitor just connected to WebOrient on ${document.title || 'DeployMate'}. Do NOT wait for them to say hello! Speak aloud right now with a warm, friendly 1-2 sentence welcome (introduce yourself as WebOrient on DeployMate, mention you can guide them around the website with the Ghost Cursor, and suggest 1 or 2 things to explore like testing the live voice agent, WhatsApp CRM, or calculating ROI savings). Never mention what language you are speaking—just speak naturally and pause to follow the user's lead!`);

    this.client.sendText(handoffPayload, { turnComplete: !isRestore });
  }

  _getCleanSpokenCaption(buffer) {
    if (!buffer) return '';
    const cleaned = String(buffer).replace(/\s+/g, ' ').trim();
    const sentences = cleaned.split(/(?<=[.!?।])\s+/);
    const latest = sentences[sentences.length - 1] || cleaned;
    return latest.slice(-115).trim();
  }

  _autoGroundFromModelSpeech(chunk) {
    this._modelSpeechBuffer = `${this._modelSpeechBuffer} ${chunk}`.slice(-280);
    const spokenCaption = this._getCleanSpokenCaption(this._modelSpeechBuffer);

    // Keep the active Ghost Cursor coachmark tooltip synchronized with what the agent is currently saying!
    if (this.cursor.activeTarget && spokenCaption.length >= 12) {
      this.cursor.updateActiveExplanation(spokenCaption);
    }

    if (this._isExecutingTool || Date.now() - this._lastExplicitToolTime < 2200) return;

    const match = this.scanner.matchElementFromSpeech(
      this._modelSpeechBuffer,
      this.memory.state.todoChecklist
    );

    if (match && match.selector && match.selector !== this._lastAutoGroundedSelector) {
      this._lastAutoGroundedSelector = match.selector;
      const badgeToDisplay = spokenCaption.length >= 8 ? spokenCaption : match.title;
      this.cursor.moveToElement(match.element || match.selector, true, badgeToDisplay);
      this.memory.markOriented({
        selector: match.selector,
        title: match.title,
        explanation: badgeToDisplay
      });
      this._emit('autoGrounded', { selector: match.selector, title: match.title, explanation: badgeToDisplay });
    }
  }

  async orientTopic(todoOrQuery) {
    if (!todoOrQuery) return;
    const currentFile = window.location.pathname.split('/').pop() || window.location.pathname || '/';

    if (typeof todoOrQuery === 'object' && todoOrQuery.selector) {
      if (todoOrQuery.page && todoOrQuery.page !== currentFile && todoOrQuery.page !== window.location.pathname) {
        this.queuePostNavigationActions([
          {
            name: 'move_and_highlight',
            args: { selector: todoOrQuery.selector, explanation: todoOrQuery.title }
          }
        ]);
        await this._handleNavigation(todoOrQuery.page, todoOrQuery.selector, todoOrQuery.title);
        return;
      }

      await this.handleToolCall('move_and_highlight', {
        selector: todoOrQuery.selector,
        explanation: todoOrQuery.title
      });

      if (this.client) {
        const langCfg = this.memory.getLanguageConfig();
        this.client.sendText(
          `[USER SELECTED TOPIC]: The user wants you to explain "${todoOrQuery.title}" (${todoOrQuery.selector}) right now in ${langCfg.name}. The Ghost Cursor is already highlighting it on screen. Describe it concisely in ${langCfg.name}.`
        );
      }
      return;
    }

    if (this.client) {
      this.memory.appendTranscript('user', String(todoOrQuery));
      const langCfg = this.memory.getLanguageConfig();
      this.client.sendText(
        `[USER MESSAGE (Respond strictly in ${langCfg.name} and pass all tool 'explanation' badges in ${langCfg.name})]: ${todoOrQuery}`
      );
    }
  }

  sendTextPrompt(text) {
    if (this.client && text) {
      this.orientTopic(text);
      return true;
    }
    return false;
  }

  queuePostNavigationActions(actions = []) {
    this.memory.setPendingNavigationActions(actions);
  }

  /**
   * Processes a batch of 1 or more Gemini tool calls and returns a single synchronized
   * `functionResponses` payload in <40ms for visual moves so Gemini starts speaking audio
   * AT THE EXACT SAME MOMENT the Ghost Cursor glides on screen (zero silent multi-callback lag!).
   */
  async handleToolCallBatch(calls = []) {
    if (!Array.isArray(calls) || calls.length === 0) return [];
    const responses = [];
    for (let i = 0; i < calls.length; i++) {
      const c = calls[i];
      const res = await this.handleToolCall(c.name, c.args || {}, null, {
        fastAckVisualMove: true,
        skipAnimation: i > 0 && (c.name === 'move_and_highlight' || c.name === 'show_and_describe')
      });
      if (c.id) {
        responses.push({
          id: c.id,
          name: c.name || 'move_and_highlight',
          response: { output: res }
        });
      }
    }
    if (this.client && responses.length > 0) {
      this.client.sendToolResponse(responses);
    }
    return responses;
  }

  _enqueueVisualTask(taskFn) {
    this._visualQueue = (this._visualQueue || Promise.resolve()).then(async () => {
      this._isExecutingTool = true;
      try {
        await taskFn();
      } finally {
        this._isExecutingTool = false;
        this._lastExplicitToolTime = Date.now();
      }
    }).catch(err => {
      console.warn('[WebOrient] Visual queue task error:', err);
    });
    return this._visualQueue;
  }

  async handleToolCall(name, args = {}, callId = null, options = {}) {
    console.log(`[WebOrient] Executing Tool Call: ${name}`, args);
    this._lastExplicitToolTime = Date.now();
    this._isExecutingTool = true;
    this._emit('toolCall', { name, args, callId });

    let result = { success: true, action: name };
    const spokenFallback = this._getCleanSpokenCaption(this._modelSpeechBuffer) || null;
    const explanation = args.explanation || args.spokenText || spokenFallback;
    const fastAck = Boolean(options.fastAckVisualMove);
    let deferredVisualTask = false;

    try {
      switch (name) {
        case 'show_and_describe':
        case 'move_and_highlight': {
          const targetEl = this.scanner.resolveElement(args.selector);
          if (!targetEl) {
            result = { success: false, elementFound: false, error: `Element not found: ${args.selector}` };
          } else if (options.skipAnimation) {
            this.memory.markOriented({ selector: args.selector, title: args.selector, explanation });
            result = {
              success: true,
              elementFound: true,
              selector: args.selector,
              audioSyncDirective: 'SPEAK_ALOUD_NOW: Stop calling tools and speak aloud to the user right now!'
            };
          } else if (fastAck) {
            this._lastAutoGroundedSelector = args.selector;
            const label = this.scanner._getAccessibleLabel(targetEl) || args.selector;
            this.memory.markOriented({ selector: args.selector, title: label, explanation });
            deferredVisualTask = true;
            this._enqueueVisualTask(() => this.cursor.moveToElement(targetEl, true, explanation));
            result = {
              success: true,
              elementFound: true,
              selector: args.selector,
              label,
              explanation,
              audioSyncDirective: 'SPEAK_ALOUD_NOW: The Ghost Cursor is now gliding to and spotlighting this element. Speak aloud to the user right now while they watch the cursor — DO NOT call another tool until your next turn!'
            };
          } else {
            result = await this.cursor.moveToElement(args.selector, true, explanation);
            if (result.success) {
              this._lastAutoGroundedSelector = args.selector;
              this.memory.markOriented({
                selector: args.selector,
                title: result.label || args.selector,
                explanation
              });
            }
          }
          break;
        }

        case 'click_element': {
          const el = this.scanner.resolveElement(args.selector);
          const isSubmit = el && (
            el.type === 'submit' ||
            el.hasAttribute('data-confirm-required')
          );

          if (isSubmit && this.options.requireSubmitConfirmation && !args.confirmed) {
            await this.cursor.moveToElement(el, true, explanation || 'Confirm submit');
            result = {
              success: true,
              requiresConfirmation: true,
              selector: args.selector,
              message: 'Moved cursor to submit button. Ask user to confirm before calling click_element with confirmed=true.'
            };
          } else if (fastAck && el) {
            this.memory.markOriented({ selector: args.selector, title: explanation || `Clicked ${args.selector}` });
            deferredVisualTask = true;
            this._enqueueVisualTask(() => this.cursor.click(el, explanation));
            result = {
              success: true,
              elementFound: true,
              action: 'click_element',
              selector: args.selector,
              audioSyncDirective: 'SPEAK_ALOUD_NOW: The Ghost Cursor is now clicking this element. Confirm the click aloud to the user right now!'
            };
          } else {
            result = await this.cursor.click(args.selector, explanation);
            this.memory.markOriented({ selector: args.selector, title: explanation || `Clicked ${args.selector}` });
          }
          break;
        }

        case 'fill_form_field':
          result = await this.cursor.typeIntoField(args.selector, args.value ?? '', 22, explanation);
          this.memory.markOriented({ selector: args.selector, title: explanation || `Filled ${args.selector}` });
          break;

        case 'fill_form_batch':
          result = await this.cursor.fillFormBatch(args.fields || [], explanation);
          this.memory.markOriented({ selector: args.fields?.[0]?.selector || 'form', title: explanation || `Batch filled ${result.filledCount} fields` });
          break;

        case 'scroll_page':
          if (fastAck) {
            deferredVisualTask = true;
            this._enqueueVisualTask(() => this.cursor.scroll(args.direction || 'down', args.targetSelector || null, args.amount || 'page', explanation));
            result = {
              success: true,
              action: 'scroll_page',
              direction: args.direction || 'down',
              targetSelector: args.targetSelector || null,
              audioSyncDirective: 'SPEAK_ALOUD_NOW: Page is scrolling smoothly now. Speak aloud while scrolling!'
            };
          } else {
            result = await this.cursor.scroll(
              args.direction || 'down',
              args.targetSelector || null,
              args.amount || 'page',
              explanation
            );
          }
          if (args.targetSelector) {
            this.memory.markOriented({ selector: args.targetSelector, title: explanation || args.targetSelector });
          }
          break;

        case 'swipe_or_swap':
          result = await this.cursor.swipeOrSwap(
            args.selector,
            args.action || 'next',
            args.targetValue ?? null,
            explanation
          );
          this.memory.markOriented({ selector: args.selector, title: explanation || args.selector });
          break;

        case 'navigate_route':
          result = await this._handleNavigation(args.path, args.targetSelector, explanation);
          break;

        case 'scan_visible_elements':
          result = {
            success: true,
            action: 'scan_visible_elements',
            activePopups: this.scanner.scanActiveOverlaysAndPopups(),
            elements: this.scanner.scan({ includeOffscreen: Boolean(args.includeOffscreen) })
          };
          break;

        case 'read_page_content':
          await this._manifestReadyPromise;
          result = this.scanner.readPageContent({
            query: args.query || '',
            selector: args.selector || '',
            manifest: this.manifest
          });
          const secToHighlight = args.selector || result.matchingSections?.[0]?.selector;
          if (secToHighlight) {
            if (fastAck) {
              deferredVisualTask = true;
              this._enqueueVisualTask(() =>
                this.cursor.moveToElement(
                  secToHighlight,
                  true,
                  explanation || result.matchingSections?.[0]?.heading || args.query
                )
              );
            } else {
              await this.cursor.moveToElement(
                secToHighlight,
                true,
                explanation || result.matchingSections?.[0]?.heading || args.query
              );
            }
            this.memory.markOriented({
              selector: secToHighlight,
              title: result.matchingSections?.[0]?.heading || secToHighlight
            });
          }
          break;

        case 'guide_tour':
          result = await this.cursor.guideTour(args.steps || []);
          for (const st of args.steps || []) {
            if (st.selector) {
              this.memory.markOriented({ selector: st.selector, title: st.explanation || st.selector });
            }
          }
          break;

        case 'update_session_memory':
          this.memory.updateUserIntent({
            goal: args.goal,
            interestedTier: args.interestedTier,
            language: args.language,
            note: args.note,
            todoIdDone: args.todoIdDone
          });
          result = {
            success: true,
            action: 'update_session_memory',
            sessionMemory: this.memory.getState()
          };
          break;

        default:
          console.warn(`[WebOrient] Unknown tool: ${name}`);
          result = { success: false, error: `Unknown tool: ${name}` };
      }
    } catch (err) {
      console.error(`[WebOrient] Tool error in ${name}:`, err);
      result = { success: false, action: name, error: err.message };
    } finally {
      if (!deferredVisualTask) {
        this._isExecutingTool = false;
      }
      this._lastExplicitToolTime = Date.now();
    }

    if (!fastAck) {
      await this._waitForDOMSettle(120);
    }
    result.viewportSummary = this.scanner.captureStateSnapshot();

    const doneTodos = this.memory.state.todoChecklist.filter(t => t.done).map(t => t.id);
    const pendingTodos = this.memory.state.todoChecklist.filter(t => !t.done).map(t => ({ id: t.id, page: t.page, selector: t.selector, title: t.title }));
    const langCfg = this.memory.getLanguageConfig();

    result.sessionMemoryDigest = {
      userLanguage: langCfg.code,
      userLanguageName: langCfg.name,
      languageNotes: this.memory.state.languageNotes || [],
      userGoal: this.memory.state.userIntent.goal,
      completedTodoIds: doneTodos,
      remainingTodos: pendingTodos.slice(0, 6)
    };

    if (this.client && callId) {
      this.client.sendToolResponse(callId, name, result);
    }

    this._emit('toolResult', { name, args, callId, result });
    return result;
  }

  async _handleNavigation(rawPath, targetSelector = null, explanation = null) {
    if (!rawPath) {
      return { success: false, error: 'Missing navigation path' };
    }

    await this._manifestReadyPromise;
    const path = String(rawPath).trim();

    // 1. If path is a CSS selector or hash on the current page, scroll & highlight it directly
    if (path.startsWith('#')) {
      const hashEl = document.querySelector(path);
      if (hashEl) {
        window.history.pushState({}, '', path);
        const res = await this.cursor.moveToElement(hashEl, true, explanation || path);
        this.memory.markOriented({ selector: path, title: explanation || path });
        return res;
      }
    }

    // 2. Check if there is an interactive SPA button/link on screen matching this route name (e.g. "Playground", "Start a project", "Book demo")
    const cleanKey = path.toLowerCase().replace(/^\/+|\/+$/g, '').replace(/\.html$/, '');
    if (!isWebOrientDemoSite() && cleanKey) {
      const candidateLinkOrBtn = Array.from(document.querySelectorAll('a[href], header button, nav button, #hero button, footer button'))
        .find(el => {
          const href = (el.getAttribute('href') || '').toLowerCase();
          const txt = (el.innerText || '').toLowerCase();
          return href === path.toLowerCase() || href === `/${cleanKey}` || href === `#${cleanKey}` || (cleanKey.length > 2 && txt.includes(cleanKey));
        });

      if (candidateLinkOrBtn && candidateLinkOrBtn.tagName === 'BUTTON') {
        const clickRes = await this.cursor.click(candidateLinkOrBtn, explanation || candidateLinkOrBtn.innerText.trim());
        return clickRes;
      }
    }

    let resolvedUrl = null;
    let matchedPage = null;

    if (this.manifest && Array.isArray(this.manifest.pages)) {
      const normalized = path.toLowerCase().replace(/^\/+|\/+$/g, '');
      matchedPage = this.manifest.pages.find(p => {
        const pRoute = (p.route || '').toLowerCase().replace(/^\/+|\/+$/g, '');
        const pFile = (p.file || '').toLowerCase();
        return (
          p.route === path ||
          pRoute === normalized ||
          pFile === normalized ||
          pFile === `${normalized}.html` ||
          (p.title && p.title.toLowerCase().includes(normalized) && normalized.length > 2) ||
          (Array.isArray(p.keywords) && p.keywords.includes(normalized))
        );
      });

      if (matchedPage) {
        resolvedUrl = matchedPage.file || matchedPage.route;
      }
    }

    if (!resolvedUrl) {
      if (isWebOrientDemoSite()) {
        const routeMap = {
          '/': 'test-demo.html',
          'home': 'test-demo.html',
          '/home': 'test-demo.html',
          'test-demo.html': 'test-demo.html',
          '/features': 'features.html',
          'features': 'features.html',
          'features.html': 'features.html',
          '/pricing': 'pricing.html',
          'pricing': 'pricing.html',
          'pricing.html': 'pricing.html',
          '/docs': 'docs.html',
          'docs': 'docs.html',
          'documentation': 'docs.html',
          'docs.html': 'docs.html',
          '/contact': 'contact.html',
          'contact': 'contact.html',
          'contact.html': 'contact.html'
        };
        const key = path.toLowerCase().split('#')[0].trim();
        resolvedUrl = routeMap[key] || path;
      } else {
        resolvedUrl = path.startsWith('/') || path.startsWith('http') ? path : `/${path}`;
      }
    }

    const hashPart = path.includes('#') ? `#${path.split('#')[1]}` : '';
    const currentFile = window.location.pathname.split('/').pop() || window.location.pathname || '/';
    const targetFile = resolvedUrl.split('#')[0].split('/').pop() || '/';

    if (targetFile === currentFile || resolvedUrl.split('#')[0] === window.location.pathname) {
      const selectorToFocus = targetSelector || hashPart || 'h1';
      const res = await this.cursor.moveToElement(
        selectorToFocus,
        true,
        explanation || matchedPage?.title || targetFile
      );
      this.memory.markOriented({ selector: selectorToFocus, title: explanation || selectorToFocus });
      return res;
    }

    const navLink = document.querySelector(`#global-site-header a[href*="${targetFile}"], a[href*="${targetFile}"]`);
    if (navLink) {
      await this.cursor.moveToElement(navLink, true, explanation || `${matchedPage?.title || targetFile}`);
      await this.cursor.playClickAnimation();
      await new Promise(r => setTimeout(r, 120));
    }

    const existingPending = [...(this.memory.state.pendingNavigationActions || [])];
    if (targetSelector || hashPart) {
      existingPending.unshift({
        name: 'move_and_highlight',
        args: {
          selector: targetSelector || hashPart,
          explanation: explanation || `${targetSelector || hashPart}`
        }
      });
    }
    this.memory.setPendingNavigationActions(existingPending);

    const baseDir = window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/') + 1);
    const finalHref = resolvedUrl.startsWith('http') || resolvedUrl.startsWith('/')
      ? resolvedUrl + hashPart
      : `${baseDir}${resolvedUrl}${hashPart}`;

    window.location.href = finalHref;
    return {
      success: true,
      action: 'navigate_route',
      navigatedTo: finalHref,
      pageTitle: matchedPage?.title || targetFile
    };
  }

  _waitForDOMSettle(maxWaitMs = 140) {
    return new Promise(resolve => {
      let timer = setTimeout(() => {
        observer.disconnect();
        resolve();
      }, maxWaitMs);

      const observer = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          observer.disconnect();
          resolve();
        }, 50);
      });

      if (document.body) {
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true
        });
      }
    });
  }

  _checkRestoredSession() {
    const runRestore = async () => {
      const memState = this.memory.getState();

      if (memState.isLiveActive && memState.liveEndpoint && !this.client) {
        this.options.endpoint = memState.liveEndpoint;
        try {
          await this.start({ isRestore: true });
          this._emit('sessionRestored', {
            sessionId: memState.sessionId,
            language: memState.userLanguage
          });
        } catch (err) {
          console.warn('[WebOrient] Auto-reconnect after refresh/redirect skipped:', err);
        }
      }

      const pendingActions = this.memory.consumePendingNavigationActions();
      if (pendingActions.length > 0) {
        await new Promise(r => setTimeout(r, 320));
        for (const act of pendingActions) {
          if (act && act.name) {
            await this.handleToolCall(act.name, act.args || {});
            await new Promise(r => setTimeout(r, 240));
          }
        }
      }
    };

    if (typeof document !== 'undefined') {
      if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', runRestore, { once: true });
      } else {
        setTimeout(runRestore, 80);
      }
    }
  }

  /**
   * Mounts the self-contained Siri-like Assist Pill + 5-Bar Soundwave + Active Language Badge +
   * Right-Click Language Popover inside the isolated Shadow DOM (`#weborient-shadow-host`).
   */
  _mountShadowAssistWidget() {
    const shadowRoot = this.cursor?.getOrCreateShadowRoot();
    if (!shadowRoot || shadowRoot.getElementById('wo-shadow-assist')) return;

    const currentLangCfg = this.memory.getLanguageConfig();
    const wrapper = document.createElement('div');
    wrapper.id = 'wo-shadow-assist';
    wrapper.innerHTML = `
      <style>
        #wo-assist-root {
          position: fixed;
          bottom: 24px;
          right: 24px;
          z-index: 2147483647;
          pointer-events: auto;
          font-family: 'Space Grotesk', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          user-select: none;
        }
        @keyframes wo-siri-wave {
          0%, 100% { transform: scaleY(0.28); opacity: 0.65; }
          50% { transform: scaleY(1); opacity: 1; }
        }
        @keyframes wo-pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.45; transform: scale(1.25); }
        }
        .wo-pill-btn {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 16px;
          border-radius: 999px;
          background: #0A0A0A;
          color: #FFFFFF;
          border: 1.5px solid #0A0A0A;
          box-shadow: 0 18px 38px rgba(10, 10, 10, 0.38), 0 0 0 1px rgba(255, 255, 255, 0.14);
          cursor: pointer;
          transition: transform 0.22s cubic-bezier(0.215, 0.61, 0.355, 1), background 0.2s ease, border-color 0.2s ease;
        }
        .wo-pill-btn:hover {
          background: #181818;
          transform: scale(1.04);
        }
        .wo-pill-btn:active {
          transform: scale(0.96);
        }
        .wo-pill-btn.wo-active {
          border: 2px solid ${this.options.themeColor};
        }
        .wo-mic-circle {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          background: ${this.options.themeColor};
          display: flex;
          align-items: center;
          justify-content: center;
          color: #FFFFFF;
          flex-shrink: 0;
        }
        .wo-wave-box {
          display: none;
          align-items: center;
          gap: 3.5px;
          height: 24px;
          padding: 0 2px;
        }
        .wo-bar {
          width: 3px;
          height: 20px;
          border-radius: 999px;
          background: ${this.options.themeColor};
          animation: wo-siri-wave 1.05s ease-in-out infinite;
        }
        .wo-bar:nth-child(2) { animation-delay: 0.15s; height: 25px; background: #FF6B4A; }
        .wo-bar:nth-child(3) { animation-delay: 0.3s; height: 30px; background: #FFFFFF; }
        .wo-bar:nth-child(4) { animation-delay: 0.45s; height: 24px; background: #FF6B4A; }
        .wo-bar:nth-child(5) { animation-delay: 0.6s; height: 18px; background: ${this.options.themeColor}; }
        .wo-meta {
          display: flex;
          flex-direction: column;
          text-align: left;
          padding-right: 4px;
        }
        .wo-title {
          font-family: 'Fira Code', ui-monospace, SFMono-Regular, monospace;
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.14em;
          display: flex;
          align-items: center;
          gap: 6px;
          color: #FFFFFF;
        }
        .wo-lang-chip {
          font-size: 8px;
          padding: 1px 5px;
          border-radius: 4px;
          background: rgba(230, 57, 30, 0.22);
          border: 1px solid ${this.options.themeColor};
          color: #FFFFFF;
          letter-spacing: 0.08em;
        }
        .wo-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: ${this.options.themeColor};
        }
        .wo-dot.wo-listening {
          background: #34d399;
          animation: wo-pulse-dot 1.4s ease-in-out infinite;
        }
        .wo-dot.wo-speaking {
          background: ${this.options.themeColor};
          animation: wo-pulse-dot 0.9s ease-in-out infinite;
        }
        .wo-sub {
          font-family: 'Fira Code', ui-monospace, SFMono-Regular, monospace;
          font-size: 9px;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: rgba(255, 255, 255, 0.6);
          margin-top: 1px;
        }
        .wo-lang-popover {
          display: none;
          position: absolute;
          bottom: calc(100% + 10px);
          right: 0;
          width: 196px;
          padding: 10px;
          background: #0A0A0A;
          border: 1px solid rgba(255, 255, 255, 0.22);
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
        }
        .wo-lang-popover.wo-open {
          display: block;
        }
        .wo-lang-label {
          font-family: 'Fira Code', monospace;
          font-size: 9px;
          text-transform: uppercase;
          letter-spacing: 0.18em;
          color: ${this.options.themeColor};
          margin-bottom: 6px;
        }
        .wo-lang-select {
          width: 100%;
          padding: 6px 8px;
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.22);
          color: #FFFFFF;
          font-family: 'Fira Code', monospace;
          font-size: 11px;
          outline: none;
        }
        .wo-lang-select option {
          color: #0A0A0A;
          background: #FFFFFF;
        }
      </style>
      <div id="wo-assist-root">
        <div class="wo-lang-popover" id="wo-shadow-lang-popover">
          <div class="wo-lang-label">Session Voice Language</div>
          <select class="wo-lang-select" id="wo-shadow-lang-select">
            <option value="en-IN">English (India/Global)</option>
            <option value="hinglish">Hinglish (Hindi + Eng)</option>
            <option value="hi-IN">Hindi (हिन्दी)</option>
            <option value="es-ES">Español (Spanish)</option>
            <option value="fr-FR">Français (French)</option>
          </select>
        </div>
        <button type="button" class="wo-pill-btn" id="wo-shadow-btn" aria-label="Toggle WebOrient Voice Co-Pilot">
          <div class="wo-mic-circle" id="wo-shadow-mic">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
              <line x1="12" y1="19" x2="12" y2="22"></line>
            </svg>
          </div>
          <div class="wo-wave-box" id="wo-shadow-wave">
            <div class="wo-bar"></div>
            <div class="wo-bar"></div>
            <div class="wo-bar"></div>
            <div class="wo-bar"></div>
            <div class="wo-bar"></div>
          </div>
          <div class="wo-meta">
            <span class="wo-title">
              <span>WebOrient</span>
              <span class="wo-lang-chip" id="wo-shadow-lang-badge">${currentLangCfg.badge || 'EN'}</span>
              <span class="wo-dot" id="wo-shadow-dot"></span>
            </span>
            <span class="wo-sub" id="wo-shadow-sub">Click to co-browse</span>
          </div>
        </button>
      </div>
    `;

    shadowRoot.appendChild(wrapper);
    const btn = shadowRoot.getElementById('wo-shadow-btn');
    const langPopover = shadowRoot.getElementById('wo-shadow-lang-popover');
    const langSelect = shadowRoot.getElementById('wo-shadow-lang-select');

    if (langSelect) {
      langSelect.value = this.memory.state.userLanguage || 'en-IN';
      langSelect.addEventListener('change', (e) => {
        this.memory.setLanguage(e.target.value, true, 'user manual dropdown selection');
        langPopover?.classList.remove('wo-open');
      });
    }

    if (btn) {
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        langPopover?.classList.toggle('wo-open');
      });

      btn.addEventListener('click', async () => {
        langPopover?.classList.remove('wo-open');
        if (!this.client) {
          this._syncShadowWidgetState(true, 'connecting');
          try {
            await this.start();
          } catch (_) {
            this._syncShadowWidgetState(false, 'offline');
          }
        } else {
          this.stop();
        }
      });
    }
  }

  _syncShadowWidgetState(connected, state = 'idle') {
    const shadowRoot = this.cursor?.shadowRoot;
    if (!shadowRoot) return;
    const btn = shadowRoot.getElementById('wo-shadow-btn');
    const mic = shadowRoot.getElementById('wo-shadow-mic');
    const wave = shadowRoot.getElementById('wo-shadow-wave');
    const sub = shadowRoot.getElementById('wo-shadow-sub');
    const dot = shadowRoot.getElementById('wo-shadow-dot');
    const langBadge = shadowRoot.getElementById('wo-shadow-lang-badge');
    if (langBadge) {
      const cfg = this.memory.getLanguageConfig();
      langBadge.textContent = cfg.badge || cfg.code.toUpperCase();
    }
    if (!mic || !wave || !sub) return;

    if (connected) {
      btn?.classList.add('wo-active');
      mic.style.display = 'none';
      wave.style.display = 'flex';
      if (state === 'speaking') {
        sub.textContent = 'AI Co-Browsing...';
        if (dot) dot.className = 'wo-dot wo-speaking';
      } else if (state === 'connecting') {
        sub.textContent = 'Connecting...';
        if (dot) dot.className = 'wo-dot';
      } else {
        sub.textContent = 'Listening Live...';
        if (dot) dot.className = 'wo-dot wo-listening';
      }
    } else {
      btn?.classList.remove('wo-active');
      mic.style.display = 'flex';
      wave.style.display = 'none';
      if (dot) dot.className = 'wo-dot';
      sub.textContent = state === 'offline' ? 'Relay offline' : 'Click to co-browse';
    }
  }

  _emit(eventType, detail) {
    if (typeof this.options.onEvent === 'function') {
      this.options.onEvent(eventType, detail);
    }
  }

  stop() {
    this.memory.setLiveSessionStatus(false);
    if (this.client) {
      this.client.stop();
      this.client = null;
    }
    if (this.cursor) {
      this.cursor.hideSpeechBubble();
      this.cursor.hideSpotlight();
    }
    this._syncShadowWidgetState(false, 'idle');
  }
}

/**
 * 1-Line Embed Auto-Bootstrap:
 * Works with both synchronous and `<script async src=".../weborient.js" data-site-key="wo_live_...">` tags!
 */
if (typeof window !== 'undefined') {
  window.WebOrient = WebOrient;

  const bootstrapFromScriptTag = () => {
    if (window.weborient || window.weborientInstance) return;
    const scriptEl =
      document.currentScript ||
      document.querySelector('script[data-site-key], script[data-site-id], script[data-endpoint]');

    if (scriptEl && (scriptEl.dataset.siteKey || scriptEl.dataset.siteId || scriptEl.dataset.endpoint)) {
      const siteKey = scriptEl.dataset.siteKey || 'wo_live_deploymate_demo';
      const themeAttr = scriptEl.dataset.theme || 'signal';
      const preset = THEME_PRESETS[themeAttr] || THEME_PRESETS.signal;

      window.weborientInstance = new WebOrient({
        endpoint: scriptEl.dataset.endpoint || getDefaultRelayEndpoint(),
        siteKey,
        siteId: scriptEl.dataset.siteId || siteKey,
        theme: themeAttr,
        themeColor: scriptEl.dataset.themeColor || preset.primaryColor,
        accentColor: scriptEl.dataset.accentColor || preset.accentColor,
        defaultLanguage: scriptEl.dataset.lang || 'en-IN',
        manifestUrl: scriptEl.dataset.manifest || null,
        autoMountLauncher: scriptEl.dataset.autoMount !== 'false'
      });
      window.weborient = window.weborientInstance;
    }
  };

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', bootstrapFromScriptTag, { once: true });
  } else {
    bootstrapFromScriptTag();
  }
}


window.WebOrient = WebOrient;
window.SUPPORTED_LANGUAGES = SUPPORTED_LANGUAGES;
})(window);
