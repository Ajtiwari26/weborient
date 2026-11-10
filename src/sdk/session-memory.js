/**
 * WebOrient Persistent Session & Non-Linear To-Do Memory Engine (`src/sdk/session-memory.js`)
 * - Uses `localStorage` (with `sessionStorage` mirror) so session state, active connection status,
 *   user language, user goals, and orientation To-Do progress survive BOTH cross-page redirects
 *   AND hard browser refreshes (F5 / Cmd+R) without losing the potential customer.
 * - Non-Linear To-Do Checklist (`todoChecklist`):
 *   Tracks every key section/feature across the website as a flexible To-Do item (`done: true | false`).
 *   The user and Live Model can jump to ANY page or section in ANY order—whenever a section is
 *   shown, clicked, swiped, or explained, its To-Do item is marked `done: true` automatically.
 */

const MEMORY_STORAGE_KEY = 'weborient_persistent_session_v4';

export const SUPPORTED_LANGUAGES = {
  'en-IN': { code: 'en-IN', name: 'English (India / Global)' },
  'hi-IN': { code: 'hi-IN', name: 'Hindi (हिन्दी)' },
  'hinglish': { code: 'hinglish', name: 'Hinglish (Hindi + English)' },
  'en-US': { code: 'en-US', name: 'English (US)' },
  'es-ES': { code: 'es-ES', name: 'Español (Spanish)' },
  'fr-FR': { code: 'fr-FR', name: 'Français (French)' }
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

export class SessionMemory {
  constructor(options = {}) {
    this.storageKey = options.storageKey || MEMORY_STORAGE_KEY;
    this.onChange = options.onChange || (() => {});
    this.state = this._loadOrInitialize(options);
  }

  _loadOrInitialize(options = {}) {
    try {
      const raw = localStorage.getItem(this.storageKey) || sessionStorage.getItem(this.storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.sessionId && Array.isArray(parsed.todoChecklist)) {
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
      isLiveActive: false,
      liveEndpoint: options.endpoint || 'ws://localhost:8088',
      userLanguage: options.defaultLanguage || initialLang,
      languageLocked: false,
      userIntent: {
        goal: options.defaultGoal || 'Explore WebOrient capabilities, pricing ROI, and setup',
        interestedTier: 'Pro Co-Pilot',
        customNotes: []
      },
      visitedPages: [],
      todoChecklist: DEFAULT_TODO_CHECKLIST.map(item => ({ ...item, completedAt: null })),
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

  /**
   * Sets whether the Gemini Live voice session is currently active so page refreshes/redirects auto-reconnect
   */
  setLiveSessionStatus(isActive, endpoint = null) {
    this.state.isLiveActive = Boolean(isActive);
    if (endpoint) this.state.liveEndpoint = endpoint;
    this._persist();
  }

  /**
   * Records a page visit across redirects or refreshes
   */
  recordPageVisit(pageFile) {
    const cleanFile = String(pageFile || '').split('/').pop() || 'test-demo.html';
    if (!this.state.visitedPages.includes(cleanFile)) {
      this.state.visitedPages.push(cleanFile);
      this._persist();
    }
    return this.state;
  }

  /**
   * Non-Linear To-Do Completion:
   * Marks any matching To-Do item (and records in `orientedHistory`) as `done = true` regardless of order!
   */
  markOriented({ page, selector, title, explanation }) {
    const currentFile = page || (typeof window !== 'undefined' ? window.location.pathname.split('/').pop() : 'test-demo.html') || 'test-demo.html';
    const selStr = String(selector || '').trim();
    if (!selStr) return null;

    // 1. Check off any matching item(s) in `todoChecklist` regardless of order
    const targetEl = typeof document !== 'undefined' ? (() => {
      try { return document.querySelector(selStr); } catch (_) { return null; }
    })() : null;

    for (const todo of this.state.todoChecklist) {
      if (todo.page === currentFile) {
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

    // 2. Also record granular history entry
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

  /**
   * Allows toggling or explicitly marking a To-Do checklist item by id or selector
   */
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
   */
  setLanguage(langCode, lock = true) {
    if (!langCode) return this.getLanguageConfig();
    const norm = String(langCode).trim();
    if (SUPPORTED_LANGUAGES[norm]) {
      this.state.userLanguage = norm;
    } else {
      const lower = norm.toLowerCase();
      if (lower.includes('hinglish')) this.state.userLanguage = 'hinglish';
      else if (lower.includes('hi') || lower.includes('hindi') || /[\u0900-\u097F]/.test(norm)) this.state.userLanguage = 'hi-IN';
      else if (lower.includes('es') || lower.includes('spanish')) this.state.userLanguage = 'es-ES';
      else if (lower.includes('fr') || lower.includes('french')) this.state.userLanguage = 'fr-FR';
      else if (lower.includes('us')) this.state.userLanguage = 'en-US';
      else this.state.userLanguage = 'en-IN';
    }
    if (lock) this.state.languageLocked = true;
    this._persist();
    return this.getLanguageConfig();
  }

  /**
   * Auto-detects language from user's spoken/typed transcript if not manually locked
   */
  detectLanguageFromText(text) {
    if (!text) return;
    // Detect Devanagari script -> Hindi
    if (/[\u0900-\u097F]/.test(text)) {
      this.setLanguage('hi-IN', true);
      return;
    }
    // Detect common Hinglish markers
    if (/\b(kya|kaise|dikhao|batao|chaliye|mujhe|aap|plan|karo|bhai|hai|hain|aur|mein)\b/i.test(text)) {
      this.setLanguage('hinglish', true);
    }
  }

  getLanguageConfig() {
    return SUPPORTED_LANGUAGES[this.state.userLanguage] || SUPPORTED_LANGUAGES['en-IN'];
  }

  /**
   * Records conversation transcript turns so after a page redirect or refresh,
   * the Live Model remembers the exact conversation flow!
   */
  appendTranscript(role, text) {
    if (!text || !String(text).trim()) return;
    const clean = String(text).replace(/\s+/g, ' ').trim();
    if (role === 'user') {
      this.detectLanguageFromText(clean);
    }

    const last = this.state.recentTranscripts[this.state.recentTranscripts.length - 1];
    if (last && last.role === role && Date.now() - last.timestamp < 4000) {
      last.text = `${last.text} ${clean}`.slice(-400);
      last.timestamp = Date.now();
    } else {
      this.state.recentTranscripts.push({
        role,
        text: clean.slice(0, 300),
        page: typeof window !== 'undefined' ? window.location.pathname.split('/').pop() : 'test-demo.html',
        timestamp: Date.now()
      });
    }

    if (this.state.recentTranscripts.length > 14) {
      this.state.recentTranscripts = this.state.recentTranscripts.slice(-14);
    }
    this._persist();
  }

  /**
   * Updates what the user wants (goal, interested tier, notes, form facts)
   */
  updateUserIntent({ goal, interestedTier, note, language, todoIdDone, formFactPatch }) {
    if (goal) this.state.userIntent.goal = goal;
    if (interestedTier) this.state.userIntent.interestedTier = interestedTier;
    if (note && !this.state.userIntent.customNotes.includes(note)) {
      this.state.userIntent.customNotes.push(note);
    }
    if (language) {
      this.setLanguage(language, true);
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

  /**
   * Builds the Non-Linear To-Do & Session Continuity prompt block for the Gemini Live Model
   */
  buildModelContextSummary() {
    const langCfg = this.getLanguageConfig();
    const currentFile = typeof window !== 'undefined' ? (window.location.pathname.split('/').pop() || 'test-demo.html') : 'test-demo.html';

    const doneItems = this.state.todoChecklist.filter(t => t.done);
    const pendingOnThisPage = this.state.todoChecklist.filter(t => !t.done && t.page === currentFile);
    const pendingOtherPages = this.state.todoChecklist.filter(t => !t.done && t.page !== currentFile);

    const recentTurns = this.state.recentTranscripts
      .slice(-6)
      .map(t => `  [${t.role.toUpperCase()} on ${t.page}]: ${t.text}`)
      .join('\n') || '  (Session just started)';

    return [
      `=== PERSISTENT SESSION & NON-LINEAR TO-DO MEMORY (${this.state.sessionId}) ===`,
      `1. LOCKED NATIVE LANGUAGE: ${langCfg.name} (code: ${langCfg.code}). You MUST speak and respond strictly in ${langCfg.name} throughout this session, across all page redirects and refreshes.`,
      `2. USER GOAL / WANT: "${this.state.userIntent.goal}" (Interested Tier: ${this.state.userIntent.interestedTier})`,
      `3. CURRENT ACTIVE PAGE: ${currentFile} (Pages visited so far: ${this.state.visitedPages.join(' -> ') || currentFile})`,
      `4. NON-LINEAR ORIENTATION TO-DO CHECKLIST (Follow the user in ANY order; do NOT force a rigid sequence!):`,
      `   - COMPLETED [x] (${doneItems.length}/${this.state.todoChecklist.length}): ${doneItems.map(i => `${i.title} (${i.page} ${i.selector})`).join(', ') || 'None yet'}`,
      `   - REMAINING ON CURRENT PAGE [ ] (${currentFile}): ${pendingOnThisPage.map(i => `${i.title} -> selector "${i.selector}"`).join(' | ') || 'All sections on this page are done!'}`,
      `   - REMAINING ON OTHER PAGES [ ]: ${pendingOtherPages.map(i => `${i.title} (${i.page})`).join(', ') || 'All pages complete!'}`,
      `5. VISUAL GROUNDING RULE: Every single time you describe or mention any section, card, tab, calculator, or input field on the page, you MUST call \`move_and_highlight\`, \`click_element\`, \`swipe_or_swap\`, or \`fill_form_field\` on its selector so the user sees the Ghost Cursor highlighting or clicking it on screen while you speak!`,
      `6. RECENT CONVERSATION CONTINUITY (Across Page Redirects / Refreshes):\n${recentTurns}`
    ].join('\n');
  }

  reset() {
    const keepLang = this.state?.userLanguage || 'en-IN';
    const wasConnected = this.state?.isLiveActive || false;
    const endpoint = this.state?.liveEndpoint || 'ws://localhost:8088';
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
