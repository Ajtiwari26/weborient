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

export const SUPPORTED_LANGUAGES = {
  'en-IN': { code: 'en-IN', badge: 'EN', name: 'English (India / Global)' },
  'hi-IN': { code: 'hi-IN', badge: 'HI', name: 'Hindi (हिन्दी)' },
  'hinglish': { code: 'hinglish', badge: 'HINGLISH', name: 'Hinglish (Hindi + English)' },
  'en-US': { code: 'en-US', badge: 'EN', name: 'English (US)' },
  'es-ES': { code: 'es-ES', badge: 'ES', name: 'Español (Spanish)' },
  'fr-FR': { code: 'fr-FR', badge: 'FR', name: 'Français (French)' }
};

export const DEFAULT_TODO_CHECKLIST = [
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

export function isWebOrientDemoSite() {
  if (typeof window === 'undefined') return true;
  const host = (window.location.hostname || '').toLowerCase();
  const file = window.location.pathname.split('/').pop() || '';
  if (DEMO_PAGES.has(file)) return true;
  if (host.startsWith('weborient.')) return true;
  return false;
}

export class SessionMemory {
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
      const noteEntry = `[LANG LOCK: ${cfg.code} (${cfg.name})] Locked via ${reason}. Agent MUST speak AND write all Ghost Cursor 'explanation' badges strictly in ${cfg.name}.`;
      this.state.languageNotes.push({
        code: cfg.code,
        name: cfg.name,
        note: noteEntry,
        timestamp: Date.now()
      });
      this.state.languageNotes = this.state.languageNotes.slice(-6);
      this.state.userIntent.customNotes = (this.state.userIntent.customNotes || []).filter(n => !n.startsWith('[LANG LOCK:'));
      this.state.userIntent.customNotes.push(noteEntry);

      if (typeof this.onLanguageChange === 'function' && (prevLang !== this.state.userLanguage || lock)) {
        queueMicrotask(() => this.onLanguageChange(cfg, prevLang));
      }
    }

    this._persist();
    return cfg;
  }

  /**
   * Auto-detects language from user's or model's spoken/typed transcript and locks it
   * so the agent continues in that exact language across all turns and page navigations.
   */
  detectLanguageFromText(text, role = 'user') {
    if (!text) return null;
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
      return this.setLanguage(hasLatinWords ? 'hinglish' : 'hi-IN', true, `${role} Devanagari speech transcript`);
    }

    // 3. Detect conversational Hinglish / Romanized Hindi markers
    const hinglishMatches = lower.match(
      /\b(kya|kaise|dikhao|dikhaiye|batao|bataiye|samjhao|chaliye|mujhe|mera|meri|humara|hamara|aap|aapka|karo|kariye|kijiye|band|kholo|isko|usko|yeh|ye|woh|wo|hai|hain|aur|mein|ke|ka|ki|se|par|pe|bhi|nahi|haan|accha|theek|kitna|kitne|kahan|kaunsa|dekho|dekhiye|suno|chahiye|krna|karna)\b/g
    );
    if (hinglishMatches && (hinglishMatches.length >= 2 || (role === 'user' && hinglishMatches.length >= 1))) {
      return this.setLanguage('hinglish', true, `${role} Hinglish speech markers (${hinglishMatches.slice(0, 3).join(', ')})`);
    }

    return null;
  }

  getLanguageConfig() {
    return SUPPORTED_LANGUAGES[this.state.userLanguage] || SUPPORTED_LANGUAGES['en-IN'];
  }

  appendTranscript(role, text) {
    if (!text || !String(text).trim()) return;
    const clean = String(text).replace(/\s+/g, ' ').trim();
    this.detectLanguageFromText(clean, role);

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
