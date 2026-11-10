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

const SUPPORTED_LANGUAGES = {
  'en-IN': { code: 'en-IN', name: 'English (India / Global)' },
  'hi-IN': { code: 'hi-IN', name: 'Hindi (हिन्दी)' },
  'hinglish': { code: 'hinglish', name: 'Hinglish (Hindi + English)' },
  'en-US': { code: 'en-US', name: 'English (US)' },
  'es-ES': { code: 'es-ES', name: 'Español (Spanish)' },
  'fr-FR': { code: 'fr-FR', name: 'Français (French)' }
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

class SessionMemory {
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

    this._persist(freshState);
    return freshState;
  }

  _persist(nextState = this.state) {
    nextState.updatedAt = Date.now();
    this.state = nextState;
    try {
      const serialized = JSON.stringify(nextState);
      localStorage.setItem(this.storageKey, serialized);
      sessionStorage.setItem(this.storageKey, serialized);
    } catch (_) {}
    this.onChange(this.state);
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


// --- MODULE: dom-scanner.js ---
/**
 * WebOrient DOM Scanner & Semantic Grounding Engine (v0.4.0)
 * - Assigns persistent deterministic `data-wo-id` attributes to actionable & landmark elements
 * - Resolves selectors, data-wo-id, or natural accessible labels to live DOM elements
 * - Real-time `matchElementFromSpeech(spokenText)`: maps whatever the Live Voice Agent is
 *   currently saying to the matching DOM element on screen so the Ghost Cursor highlights it automatically!
 * - Extracts structured page content, headings, pricing cards, FAQs, and tables for Q&A
 * - Filters out sensitive fields (passwords, credit cards, [data-agent-ignore])
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
      '#test-toolbar',
      '#test-toolbar *'
    ];
    this._idCounter = 1;
  }

  /**
   * Real-time Transcript-to-DOM Matcher:
   * Given a phrase currently being spoken by the Gemini Live Agent, finds the best matching
   * DOM section, card, tab, button, or form field on the active page so the Ghost Cursor
   * automatically scrolls to and highlights whatever the agent is describing!
   */
  matchElementFromSpeech(spokenText, todoChecklist = []) {
    if (!spokenText || typeof document === 'undefined') return null;
    const text = String(spokenText).toLowerCase().trim();
    if (text.length < 4) return null;

    const currentFile = window.location.pathname.split('/').pop() || 'test-demo.html';

    // 1. Check current-page To-Do checklist keywords first for high-precision section matching
    const pageTodos = (todoChecklist || []).filter(t => t.page === currentFile);
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

    // 2. Match against interactive controls, cards, tabs, headings, and sections on the page
    const candidates = this._querySelectorAllDeep(
      'section[id], .pricing-card, [role="tab"], [role="switch"], [data-carousel], details[id], form[id], button[id], input[id], select[id], h2, h3'
    ).filter(el => !this._isIgnored(el) && this._isVisible(el, true));

    let bestEl = null;
    let bestScore = 0;
    let bestLabel = '';

    for (const el of candidates) {
      const label = (this._extractHeading(el) || this._getAccessibleLabel(el) || '').toLowerCase();
      const idStr = (el.id || '').replace(/[-_]/g, ' ').toLowerCase();
      if (!label && !idStr) continue;

      let score = 0;
      // Check significant words (>= 4 chars)
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
      const targetNode = bestEl.closest('section[id], .pricing-card, details[id]') || bestEl;
      return {
        element: targetNode,
        selector: this._getUniqueSelector(targetNode),
        title: bestLabel || this._extractHeading(targetNode)
      };
    }

    return null;
  }

  /**
   * Resolves a selector, data-wo-id, element ID, or accessible label to a DOM element
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
   * Scans and returns an array of interactive elements with rich state & selectors
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

        const item = {
          woId,
          selector: this._getUniqueSelector(el),
          tag: el.tagName.toLowerCase(),
          type: el.type || el.getAttribute('role') || null,
          role: el.getAttribute('role') || null,
          label: this._getAccessibleLabel(el),
          inViewport,
          isInteractive: true,
          disabled: Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true')
        };

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

    const sectionNodes = Array.from(
      document.querySelectorAll('section, article, main, [data-section], .pricing-card, details')
    ).filter(el => !this._isIgnored(el) && this._isVisible(el, true));

    const sections = sectionNodes.map(sec => {
      const woId = this._ensureWoId(sec);
      const heading = this._extractHeading(sec);
      const text = this._cleanText(sec.innerText || '', 600);
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
      matchingSections: filteredSections.length > 0 ? filteredSections : sections.slice(0, 8),
      manifestKnowledge: manifestMatches.slice(0, 6)
    };
  }

  captureStateSnapshot() {
    const visibleInteractive = this.scan({ includeOffscreen: false });
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
      visibleInteractiveCount: visibleInteractive.length,
      invalidFields
    };
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
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) {
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

    const placeholder = el.getAttribute('placeholder');
    if (placeholder) return placeholder.trim();

    const title = el.getAttribute('title') || el.getAttribute('data-tooltip');
    if (title) return title.trim();

    const text = el.innerText || el.value || '';
    return text.replace(/\s+/g, ' ').trim().slice(0, 80);
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
    if (h) return h.innerText.trim();
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
      if (node.shadowRoot) {
        results.push(...this._querySelectorAllDeep(selector, node.shadowRoot));
      }
    }
    return results;
  }

  _queryShadowRoots(selector, root = document.body) {
    if (!root) return null;
    const allNodes = root.querySelectorAll('*');
    for (const node of allNodes) {
      if (node.shadowRoot) {
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
 * WebOrient Ghost Cursor & Deterministic UI Actuator (v0.3.0 — Synchronized Salesperson Edition)
 * - True Cubic Bézier + Fitts's Law human-like 60fps cursor trajectory
 * - Scroll-locked element spotlight + floating glassmorphic explanation coachmark
 * - Live Synchronized Salesperson Teleprompter Bubble (`showSpeechBubble`) attached to cursor
 * - Salesperson deictic emphasis gesture (`pulseEmphasis`) while speaking
 * - React/Vue/Angular compatible form filling (`HTMLInputElement.prototype.value` setter)
 * - Spoken input normalization (emails, numbers, booleans) & live validation feedback
 * - Smart viewport & nested container scrolling (`up`, `down`, `top`, `bottom`, `targetSelector`)
 * - Gesture & swap actuation (`swipeOrSwap`) for carousels, tabs, toggle switches, and range sliders
 */
class GhostCursor {
  constructor(options = {}) {
    this.primaryColor = options.primaryColor || '#6366f1';
    this.accentColor = options.accentColor || '#ec4899';
    this.cursorStyle = options.cursorStyle || 'modern-glow';
    this.scanner = options.scanner || null;
    this.currentPosition = {
      x: typeof window !== 'undefined' ? window.innerWidth / 2 : 500,
      y: typeof window !== 'undefined' ? window.innerHeight / 2 : 400
    };
    this.isMoving = false;
    this.activeTarget = null;
    this.activeExplanation = null;
    this._abortController = null;
    this._rafId = null;

    this._initOverlay();
  }

  _initOverlay() {
    if (typeof document === 'undefined') return;
    const existing = document.getElementById('weborient-overlay');
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
    `;

    // Spotlight Element Bounding Box
    this.spotlight = document.createElement('div');
    this.spotlight.id = 'weborient-spotlight';
    this.spotlight.style.cssText = `
      position: fixed;
      border: 2px solid ${this.primaryColor};
      border-radius: 10px;
      box-shadow: 0 0 26px ${this.primaryColor}88, inset 0 0 12px ${this.primaryColor}33;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.25s ease, top 0.15s ease-out, left 0.15s ease-out, width 0.2s ease-out, height 0.2s ease-out;
      z-index: 2147483645;
    `;

    // Floating Explanation Coachmark / Tooltip
    this.tooltip = document.createElement('div');
    this.tooltip.id = 'weborient-tooltip';
    this.tooltip.style.cssText = `
      position: fixed;
      max-width: 340px;
      padding: 8px 13px;
      background: rgba(15, 23, 42, 0.95);
      backdrop-filter: blur(10px);
      border: 1px solid ${this.primaryColor};
      border-radius: 10px;
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 12px;
      line-height: 1.45;
      font-weight: 500;
      box-shadow: 0 12px 28px -5px rgba(0, 0, 0, 0.6), 0 0 16px ${this.primaryColor}44;
      pointer-events: none;
      opacity: 0;
      transform: translateY(4px);
      transition: opacity 0.25s ease, transform 0.25s ease, top 0.15s ease-out, left 0.15s ease-out;
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
    this.trailPath.setAttribute('stroke', this.accentColor);
    this.trailPath.setAttribute('stroke-width', '3');
    this.trailPath.setAttribute('stroke-linecap', 'round');
    this.trailPath.setAttribute('stroke-dasharray', '6 4');
    this.trailPath.style.opacity = '0';
    this.trailPath.style.transition = 'opacity 0.35s ease';
    this.trailSvg.appendChild(this.trailPath);

    // Ghost Cursor Pointer + Live Synchronized Speech Bubble
    this.cursor = document.createElement('div');
    this.cursor.id = 'weborient-cursor';
    this.cursor.innerHTML = `
      <div class="weborient-pointer" style="position: relative; width: 30px; height: 30px;">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" style="filter: drop-shadow(0 3px 10px rgba(0,0,0,0.45));">
          <path d="M4 3L11 20L14.5 13.5L21 11L4 3Z" fill="${this.primaryColor}" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/>
        </svg>
        <div class="weborient-ring" style="
          position: absolute; top: -6px; left: -6px; width: 34px; height: 34px;
          border: 2px solid ${this.accentColor}; border-radius: 50%;
          opacity: 0; transform: scale(0.6);
          transition: transform 0.32s ease-out, opacity 0.32s ease-out;
        "></div>
        <div class="weborient-badge" style="
          position: absolute; top: 20px; left: 16px;
          background: linear-gradient(135deg, ${this.primaryColor}, ${this.accentColor});
          color: #fff;
          font-size: 9px; font-weight: 700; letter-spacing: 0.04em;
          padding: 2px 7px; border-radius: 999px;
          white-space: nowrap; box-shadow: 0 2px 8px rgba(0,0,0,0.35);
          font-family: -apple-system, BlinkMacSystemFont, sans-serif;
          display: flex; align-items: center; gap: 4px;
        ">
          <span class="wo-speaking-dot" style="width:5px;height:5px;border-radius:50%;background:#34d399;display:inline-block;"></span>
          <span class="wo-badge-label">AI Sales Co-Pilot</span>
        </div>
        <div class="weborient-speech-bubble" style="
          position: absolute; top: 40px; left: 16px;
          width: 250px; padding: 7px 10px;
          background: rgba(15, 23, 42, 0.96);
          border-left: 3px solid ${this.accentColor};
          border-radius: 8px;
          color: #e2e8f0;
          font-size: 11px; line-height: 1.35;
          font-family: -apple-system, BlinkMacSystemFont, sans-serif;
          box-shadow: 0 8px 20px rgba(0,0,0,0.5);
          opacity: 0; transform: translateY(4px);
          transition: opacity 0.2s ease, transform 0.2s ease;
          pointer-events: none;
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
    document.body.appendChild(this.container);

    this._boundSyncPosition = () => this._syncSpotlightPosition();
    window.addEventListener('scroll', this._boundSyncPosition, { passive: true, capture: true });
    window.addEventListener('resize', this._boundSyncPosition, { passive: true });
  }

  /**
   * Displays synchronized live speech subtitles right underneath the Ghost Cursor while speaking
   */
  showSpeechBubble(text, badgeLabel = 'Speaking Live...') {
    if (!this.cursor) return;
    const bubble = this.cursor.querySelector('.weborient-speech-bubble');
    const label = this.cursor.querySelector('.wo-badge-label');
    if (label && badgeLabel) label.textContent = badgeLabel;
    if (bubble) {
      bubble.textContent = `“${text}”`;
      bubble.style.opacity = '1';
      bubble.style.transform = 'translateY(0)';
    }
  }

  hideSpeechBubble() {
    if (!this.cursor) return;
    const bubble = this.cursor.querySelector('.weborient-speech-bubble');
    const label = this.cursor.querySelector('.wo-badge-label');
    if (label) label.textContent = 'AI Sales Co-Pilot';
    if (bubble) {
      bubble.style.opacity = '0';
      bubble.style.transform = 'translateY(4px)';
    }
  }

  /**
   * Subtle salesperson pointing/circling gesture on the active element while speaking
   */
  async performSpeakingGesture(el) {
    if (!el || !document.body.contains(el)) return;
    const rect = el.getBoundingClientRect();
    const baseX = Math.max(20, Math.min(window.innerWidth - 280, rect.left + rect.width * 0.35));
    const baseY = Math.max(20, Math.min(window.innerHeight - 100, rect.top + Math.min(48, rect.height * 0.4)));
    await this.moveTo(baseX + 26, baseY - 6, 320);
    await this.moveTo(baseX, baseY, 320);
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
   * Moves cursor along a human-like Cubic Bézier trajectory with Fitts's Law easing
   */
  async moveTo(targetX, targetY, durationMs = 500) {
    if (this._rafId) cancelAnimationFrame(this._rafId);

    // Keep cursor within visible screen bounds so the speech bubble stays readable
    const clampedX = Math.max(16, Math.min(window.innerWidth - 40, targetX));
    const clampedY = Math.max(16, Math.min(window.innerHeight - 40, targetY));

    const startX = this.currentPosition.x;
    const startY = this.currentPosition.y;
    const dx = clampedX - startX;
    const dy = clampedY - startY;
    const distance = Math.hypot(dx, dy);

    if (distance < 2) {
      this.currentPosition = { x: clampedX, y: clampedY };
      this.cursor.style.transform = `translate3d(${clampedX}px, ${clampedY}px, 0)`;
      return;
    }

    const scaledDuration = Math.min(820, Math.max(220, durationMs * (0.55 + Math.log2(distance / 60 + 1) * 0.22)));

    const nx = -dy / distance;
    const ny = dx / distance;
    const arcRadius = Math.min(100, distance * 0.22) * (Math.random() > 0.5 ? 1 : -1);

    const p1x = startX + dx * 0.28 + nx * arcRadius;
    const p1y = startY + dy * 0.28 + ny * arcRadius;

    const overshoot = distance > 180 ? 4 : 0;
    const p2x = startX + dx * 0.76 + nx * (arcRadius * 0.35) + (dx / distance) * overshoot;
    const p2y = startY + dy * 0.76 + ny * (arcRadius * 0.35) + (dy / distance) * overshoot;

    this.isMoving = true;
    this.cursor.style.transition = 'none';

    return new Promise(resolve => {
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
          this.currentPosition = { x: clampedX, y: clampedY };
          this.cursor.style.transform = `translate3d(${clampedX}px, ${clampedY}px, 0)`;
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

    const pad = 6;
    this.spotlight.style.top = `${rect.top - pad}px`;
    this.spotlight.style.left = `${rect.left - pad}px`;
    this.spotlight.style.width = `${rect.width + pad * 2}px`;
    this.spotlight.style.height = `${rect.height + pad * 2}px`;
    this.spotlight.style.opacity = '1';

    if (this.activeExplanation) {
      this.tooltip.innerHTML = `
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${this.accentColor};flex-shrink:0;"></span>
          <span>${this._escapeHtml(this.activeExplanation)}</span>
        </div>
      `;
      const placeAbove = rect.top > 70;
      const topPos = placeAbove ? Math.max(12, rect.top - 48) : Math.min(window.innerHeight - 56, rect.bottom + 12);
      const leftPos = Math.max(12, Math.min(window.innerWidth - 350, rect.left));

      this.tooltip.style.top = `${topPos}px`;
      this.tooltip.style.left = `${leftPos}px`;
      this.tooltip.style.opacity = '1';
      this.tooltip.style.transform = 'translateY(0)';
    } else {
      this.tooltip.style.opacity = '0';
    }
  }

  async moveToElement(selector, highlight = true, explanation = null) {
    const el = this._resolve(selector);
    if (!el) {
      console.warn(`[WebOrient] Element not found: ${selector}`);
      return { success: false, elementFound: false, error: `Element not found: ${selector}` };
    }

    const initialRect = el.getBoundingClientRect();
    const outOfView = initialRect.top < 70 || initialRect.bottom > window.innerHeight - 70;
    if (outOfView) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      await this._sleep(360);
    }

    const rect = el.getBoundingClientRect();
    const targetX = Math.max(16, Math.min(window.innerWidth - 260, rect.left + Math.min(rect.width / 2, 180)));
    const targetY = Math.max(16, Math.min(window.innerHeight - 90, rect.top + Math.min(rect.height / 2, 60)));

    await this.moveTo(targetX, targetY);

    el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: targetX, clientY: targetY }));
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: targetX, clientY: targetY }));
    el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, clientX: targetX, clientY: targetY }));

    if (highlight) {
      this.activeTarget = el;
      this.activeExplanation = explanation || null;
      this._syncSpotlightPosition();
    }

    return {
      success: true,
      elementFound: true,
      element: el,
      selector: typeof selector === 'string' ? selector : (el.id ? `#${el.id}` : el.tagName.toLowerCase()),
      label: el.innerText?.trim()?.slice(0, 80) || el.getAttribute('aria-label') || null,
      explanation: explanation || null
    };
  }

  async guideTour(steps = [], speechSync = null) {
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
      const badgeText = `[${i + 1}/${steps.length}] ${step.explanation || 'Tour Stop'}`;
      const res = await this.moveToElement(step.selector, true, badgeText);

      if (speechSync && (step.spokenText || step.explanation)) {
        const textToSpeak = step.spokenText || step.explanation;
        this.showSpeechBubble(textToSpeak, `Step ${i + 1} of ${steps.length}`);
        await speechSync.speakSynchronized(textToSpeak);
        this.hideSpeechBubble();
      } else {
        const dwell = Math.min(4000, Math.max(600, step.dwellMs || 1200));
        await this._sleep(dwell);
      }

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

  async click(selector, explanation = null) {
    const el = this._resolve(selector);
    if (!el) {
      return { success: false, elementFound: false, error: `Element not found: ${selector}` };
    }

    const res = await this.moveToElement(el, true, explanation);
    if (!res.success) return res;

    const ring = this.cursor.querySelector('.weborient-ring');
    const pointer = this.cursor.querySelector('.weborient-pointer');
    if (ring) {
      ring.style.opacity = '1';
      ring.style.transform = 'scale(1.75)';
    }
    if (pointer) {
      pointer.style.transform = 'scale(0.88)';
    }
    await this._sleep(180);
    if (ring) {
      ring.style.opacity = '0';
      ring.style.transform = 'scale(0.6)';
    }
    if (pointer) {
      pointer.style.transform = 'scale(1)';
    }

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

  async typeIntoField(selector, rawValue, charDelayMs = 22) {
    const el = this._resolve(selector);
    if (!el) {
      return { success: false, elementFound: false, error: `Form field not found: ${selector}` };
    }

    const normalizedValue = this._normalizeVoiceInput(el, rawValue);
    const res = await this.moveToElement(el, true, `Filling: ${normalizedValue}`);
    if (!res.success) return res;

    if (typeof el.focus === 'function') el.focus({ preventScroll: true });

    const tag = el.tagName.toLowerCase();
    const type = (el.type || '').toLowerCase();

    if (tag === 'select') {
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
      const numVal = parseFloat(String(normalizedValue).replace(/[^0-9.-]/g, ''));
      const finalRangeVal = Number.isFinite(numVal) ? String(numVal) : String(normalizedValue);
      this._setNativeValue(el, finalRangeVal);
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

  async fillFormBatch(fields = []) {
    if (!Array.isArray(fields) || fields.length === 0) {
      return { success: false, error: 'No fields provided for batch fill' };
    }

    const results = [];
    for (const item of fields) {
      if (!item || !item.selector) continue;
      const res = await this.typeIntoField(item.selector, item.value ?? '', 12);
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

  async scroll(direction = 'down', targetSelector = null, amount = 'page') {
    if (targetSelector) {
      const targetEl = this._resolve(targetSelector);
      if (targetEl) {
        return await this.moveToElement(targetEl, true, `Scrolled to ${targetSelector}`);
      }
    }

    const dir = String(direction || 'down').toLowerCase();
    const distanceRatio = amount === 'small' ? 0.35 : (amount === 'half' ? 0.5 : 0.75);
    const scrollAmount = Math.round(window.innerHeight * distanceRatio);

    if (dir === 'top') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (dir === 'bottom') {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
    } else if (dir === 'up') {
      window.scrollBy({ top: -scrollAmount, behavior: 'smooth' });
    } else {
      window.scrollBy({ top: scrollAmount, behavior: 'smooth' });
    }

    await this._sleep(420);
    this._syncSpotlightPosition();

    return {
      success: true,
      action: 'scroll_page',
      direction: dir,
      scrollY: Math.round(window.scrollY)
    };
  }

  async swipeOrSwap(selector, action = 'next', targetValue = null) {
    const el = this._resolve(selector);
    if (!el) {
      return { success: false, elementFound: false, error: `Target widget not found: ${selector}` };
    }

    const act = String(action || 'next').toLowerCase();

    if (el.tagName === 'INPUT' && el.type === 'range') {
      const min = parseFloat(el.min || '0');
      const max = parseFloat(el.max || '100');
      const current = parseFloat(el.value || '0');
      const step = parseFloat(el.step || '1') || Math.max(1, (max - min) * 0.1);
      let nextVal = current;

      if (targetValue !== null && targetValue !== undefined && targetValue !== '') {
        nextVal = parseFloat(String(targetValue).replace(/[^0-9.-]/g, ''));
      } else if (act === 'next' || act === 'right') {
        nextVal = Math.min(max, current + step * 5);
      } else if (act === 'prev' || act === 'left') {
        nextVal = Math.max(min, current - step * 5);
      }
      return await this.typeIntoField(el, String(nextVal));
    }

    if (el.getAttribute('role') === 'switch' || (el.tagName === 'INPUT' && el.type === 'checkbox')) {
      return await this.click(el, `Toggled switch`);
    }

    if (
      el.getAttribute('role') === 'tablist' ||
      el.getAttribute('role') === 'tab' ||
      el.hasAttribute('data-tab') ||
      el.querySelector('[role="tab"], [data-tab]')
    ) {
      const tabContainer = (el.getAttribute('role') === 'tab' || el.hasAttribute('data-tab'))
        ? (el.closest('[role="tablist"]') || el.parentElement)
        : el;
      const tabs = Array.from(tabContainer.querySelectorAll('[role="tab"], [data-tab], button'));

      let targetTab = el.getAttribute('role') === 'tab' || el.hasAttribute('data-tab') ? el : null;
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
        await this.click(targetTab, `Swapped to tab: ${targetTab.innerText.trim()}`);
        return {
          success: true,
          action: 'swipe_or_swap',
          widgetType: 'tabs',
          activeTab: targetTab.innerText.trim() || targetTab.getAttribute('data-tab')
        };
      }
    }

    await this.moveToElement(el, true, `Swiping ${act}`);
    const rect = el.getBoundingClientRect();
    const cy = rect.top + rect.height / 2;
    const isLeftSwipe = act === 'next' || act === 'left';
    const startX = isLeftSwipe ? rect.left + rect.width * 0.75 : rect.left + rect.width * 0.25;
    const endX = isLeftSwipe ? rect.left + rect.width * 0.25 : rect.left + rect.width * 0.75;

    await this._animateSwipeGesture(el, startX, cy, endX, cy);

    const btnSelector = isLeftSwipe
      ? '[data-carousel-next], .carousel-next, [aria-label*="Next" i]'
      : '[data-carousel-prev], .carousel-prev, [aria-label*="Prev" i]';
    const navBtn = el.querySelector(btnSelector) || el.parentElement?.querySelector(btnSelector);

    if (targetValue !== null && targetValue !== undefined && targetValue !== '') {
      const idx = parseInt(targetValue, 10);
      const indicator = el.querySelector(`[data-slide-to="${idx}"]`);
      if (indicator) indicator.click();
    } else if (navBtn) {
      navBtn.click();
    }

    const slides = Array.from(el.querySelectorAll('[data-carousel-slide], .carousel-slide'));
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
    if (this.trailPath) {
      this.trailPath.setAttribute('d', `M ${startX} ${startY} Q ${(startX + endX) / 2} ${startY - 22} ${endX} ${endY}`);
      this.trailPath.style.opacity = '0.9';
    }

    await this.moveTo(startX, startY, 220);

    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: startX, clientY: startY }));
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: startX, clientY: startY }));

    const steps = 6;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const cx = startX + (endX - startX) * t;
      const cy = startY + (endY - startY) * t;
      el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: cx, clientY: cy }));
      el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: cx, clientY: cy }));
    }

    await this.moveTo(endX, endY, 260);

    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: endX, clientY: endY }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: endX, clientY: endY }));

    if (this.trailPath) {
      setTimeout(() => {
        if (this.trailPath) this.trailPath.style.opacity = '0';
      }, 350);
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
 * WebOrient Live Client (v0.4.0)
 * - Captures 16kHz mono PCM microphone audio (AudioWorklet with ScriptProcessor fallback)
 * - Decodes and plays 24kHz Int16 PCM model audio streams gaplessly via Web Audio API
 * - Instant barge-in cancellation (<50ms) stopping all active AudioBufferSourceNodes
 * - Forwards both User (`inputTranscription`) and Model (`outputTranscription`) speech transcripts
 *   so WebOrient can auto-highlight described DOM elements in real time and lock user language!
 */
class LiveClient {
  constructor(options = {}) {
    this.endpoint = options.endpoint || 'ws://localhost:8088';
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

    // 4. Handle model tool calls
    if (msg.toolCall?.functionCalls) {
      for (const call of msg.toolCall.functionCalls) {
        this.onToolCall(call.name, call.args || {}, call.id);
      }
    }
  }

  async _scheduleAudioChunk(base64Audio, sampleRate = 24000) {
    if (!this.playbackContext || !base64Audio) return;
    if (this.playbackContext.state === 'suspended') {
      await this.playbackContext.resume();
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

  sendToolResponse(callId, toolName, output) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        toolResponse: {
          functionResponses: [
            {
              id: callId,
              name: toolName || 'tool_result',
              response: { output }
            }
          ]
        }
      }));
    }
  }

  sendText(text) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && text) {
      this.ws.send(JSON.stringify({ text: String(text) }));
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
 * WebOrient: Adaptive Gemini Live Voice Co-Pilot & Non-Linear To-Do Memory SDK (v0.4.0)
 * - ZERO Browser TTS: All spoken orientation comes natively from the Gemini Live Model
 * - Non-Linear To-Do Checklist Memory (`SessionMemory`): tracks completed vs. remaining sections
 *   in ANY order as the user explores or asks questions
 * - 100% Visual DOM Grounding:
 *   1) Explicit Tool Grounding (`move_and_highlight`, `show_and_describe`, `click_element`, `swipe_or_swap`, `fill_form_field`)
 *   2) Real-Time Transcript-to-DOM Auto-Highlighting (`_autoGroundFromModelSpeech`): whenever the Live Model
 *      speaks about a DOM section/card/control on the page, the Ghost Cursor automatically scrolls to it,
 *      spotlights it, displays the live spoken subtitle, and checks off its To-Do item!
 * - Refresh-Safe & Redirect-Safe Session Management:
 *   Persists session state, locked `userLanguage`, and To-Do checklist in `localStorage` so page redirects
 *   and hard browser refreshes (`F5`/`Cmd+R`) automatically resume the session in the user's language.
 */




class WebOrient {
  constructor(options = {}) {
    this.options = Object.assign({
      endpoint: null,
      siteId: 'acme_default',
      themeColor: '#6366f1',
      accentColor: '#ec4899',
      cursorStyle: 'modern-glow',
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
      endpoint: this.options.endpoint,
      onChange: (memState) => this._emit('memoryUpdate', memState)
    });

    this.client = null;
    this.manifest = null;
    this._modelSpeechBuffer = '';
    this._lastAutoGroundedSelector = null;
    this._lastExplicitToolTime = 0;

    if (typeof window !== 'undefined') {
      const currentFile = window.location.pathname.split('/').pop() || 'test-demo.html';
      this.memory.recordPageVisit(currentFile);
    }

    this._manifestReadyPromise = this.options.manifestUrl
      ? this.loadManifest(this.options.manifestUrl)
      : Promise.resolve(null);

    if (this.options.autoMountLauncher && typeof document !== 'undefined') {
      this._mountFloatingLauncher();
    }

    this._checkRestoredSession();
  }

  async loadManifest(url) {
    try {
      const res = await fetch(url);
      this.manifest = await res.json();
      console.log('[WebOrient] Loaded site manifest:', this.manifest.siteName);
      return this.manifest;
    } catch (e) {
      console.warn('[WebOrient] Failed to load manifest:', e);
      return null;
    }
  }

  /**
   * Connects microphone audio to the Gemini Live Model and injects the persistent
   * Non-Linear To-Do Checklist, Locked Language, and Recent Conversation Continuity.
   */
  async start() {
    const endpoint = this.options.endpoint || this.memory.state.liveEndpoint;
    if (!endpoint) {
      console.warn('[WebOrient] No WebSocket endpoint provided.');
      return;
    }
    this.options.endpoint = endpoint;

    const sep = endpoint.includes('?') ? '&' : '?';
    const wsUrl = `${endpoint}${sep}siteId=${encodeURIComponent(this.options.siteId)}&sessionId=${encodeURIComponent(this.memory.state.sessionId)}&lang=${encodeURIComponent(this.memory.state.userLanguage)}`;

    this.client = new LiveClient({
      endpoint: wsUrl,
      onToolCall: (name, args, callId) => this.handleToolCall(name, args, callId),
      onStatusChange: (status) => {
        console.log(`[WebOrient] Status: ${status}`);
        this._emit('status', { status });
      },
      onTranscript: (text, role) => {
        this.memory.appendTranscript(role, text);
        if (role === 'model') {
          this.cursor.showSpeechBubble(text, `Live AI (${this.memory.state.userLanguage})`);
          this._autoGroundFromModelSpeech(text);
        }
        this._emit('transcript', { text, role });
      },
      onPlaybackChange: (isPlaying) => {
        if (!isPlaying) {
          this._modelSpeechBuffer = '';
          setTimeout(() => {
            if (!this.client?.isPlaying) this.cursor.hideSpeechBubble();
          }, 800);
        }
      },
      onInterrupted: () => {
        this._modelSpeechBuffer = '';
        this.cursor.cancelActiveActions();
        this._emit('interrupted', {});
      }
    });

    await this.client.connect();
    this.memory.setLiveSessionStatus(true, endpoint);

    // Send full Non-Linear To-Do Checklist + Active Viewport Elements + Language Continuity Handoff
    const initialSnapshot = this.scanner.captureStateSnapshot();
    const initialElements = this.scanner.scan({ includeOffscreen: true }).slice(0, 35);
    const memorySummary = this.memory.buildModelContextSummary();

    this.client.sendText(
      `[SESSION CONTINUITY HANDOFF]\n${memorySummary}\n` +
      `[CURRENT PAGE DOM ("${document.title}" - ${initialSnapshot.url})]:\n` +
      `Interactive & Section Elements on Screen: ${JSON.stringify(initialElements.map(e => ({ selector: e.selector, label: e.label, tag: e.tag, type: e.type })))}`
    );
  }

  /**
   * Real-Time Transcript-to-DOM Auto-Grounding:
   * Guarantees that EVERY part of the DOM described by the Live Model is automatically
   * scrolled into view, spotlighted, and pointed to by the Ghost Cursor—even if the model
   * mentions a section in speech before or without emitting an explicit tool call!
   */
  _autoGroundFromModelSpeech(chunk) {
    this._modelSpeechBuffer = `${this._modelSpeechBuffer} ${chunk}`.slice(-260);

    // Avoid overriding an explicit tool call that just fired within the last 1.2s
    if (Date.now() - this._lastExplicitToolTime < 1200) return;

    const match = this.scanner.matchElementFromSpeech(
      this._modelSpeechBuffer,
      this.memory.state.todoChecklist
    );

    if (match && match.selector && match.selector !== this._lastAutoGroundedSelector) {
      this._lastAutoGroundedSelector = match.selector;
      this.cursor.moveToElement(match.element || match.selector, true, match.title);
      this.memory.markOriented({
        selector: match.selector,
        title: match.title,
        explanation: this._modelSpeechBuffer.trim().slice(-120)
      });
      this._emit('autoGrounded', { selector: match.selector, title: match.title });
    }
  }

  /**
   * Sends a user request or topic selection to the Live Model (or executes locally if offline)
   */
  async orientTopic(todoOrQuery) {
    if (!todoOrQuery) return;
    const currentFile = window.location.pathname.split('/').pop() || 'test-demo.html';

    // If passed a structured To-Do item from the checklist
    if (typeof todoOrQuery === 'object' && todoOrQuery.selector) {
      // If it lives on another page, queue highlight + Live Model prompt and redirect
      if (todoOrQuery.page && todoOrQuery.page !== currentFile) {
        this.queuePostNavigationActions([
          {
            name: 'move_and_highlight',
            args: { selector: todoOrQuery.selector, explanation: todoOrQuery.title }
          }
        ]);
        await this._handleNavigation(todoOrQuery.page, todoOrQuery.selector, todoOrQuery.title);
        return;
      }

      // Same page: highlight with Ghost Cursor, mark To-Do done, and ask Live Model to explain it in user's language
      await this.handleToolCall('move_and_highlight', {
        selector: todoOrQuery.selector,
        explanation: todoOrQuery.title
      });

      if (this.client) {
        const langCfg = this.memory.getLanguageConfig();
        this.client.sendText(
          `[USER SELECTED TOPIC]: The user wants you to explain "${todoOrQuery.title}" (${todoOrQuery.selector}) right now in ${langCfg.name}. The Ghost Cursor is already highlighting it on screen. Describe it concisely and naturally.`
        );
      }
      return;
    }

    // String prompt
    if (this.client) {
      this.memory.appendTranscript('user', String(todoOrQuery));
      const langCfg = this.memory.getLanguageConfig();
      this.client.sendText(
        `[USER MESSAGE (Respond in ${langCfg.name} and call move_and_highlight/click_element/swipe_or_swap on every DOM element you describe)]: ${todoOrQuery}`
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
   * Routes model tool calls to DOM actuators with closed-loop settle, verification & To-Do completion
   */
  async handleToolCall(name, args = {}, callId = null) {
    console.log(`[WebOrient] Executing Tool Call: ${name}`, args);
    this._lastExplicitToolTime = Date.now();
    this._emit('toolCall', { name, args, callId });

    let result = { success: true, action: name };

    try {
      switch (name) {
        case 'show_and_describe':
        case 'move_and_highlight': {
          const explanation = args.explanation || args.spokenText || null;
          result = await this.cursor.moveToElement(args.selector, true, explanation);
          if (result.success) {
            this._lastAutoGroundedSelector = args.selector;
            this.memory.markOriented({
              selector: args.selector,
              title: result.label || args.selector,
              explanation
            });
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
            await this.cursor.moveToElement(el, true, 'Awaiting your confirmation to submit');
            result = {
              success: true,
              requiresConfirmation: true,
              selector: args.selector,
              message: 'Moved cursor to submit button. Ask user to confirm before calling click_element with confirmed=true.'
            };
          } else {
            result = await this.cursor.click(args.selector, args.explanation || null);
            this.memory.markOriented({ selector: args.selector, title: `Clicked ${args.selector}` });
          }
          break;
        }

        case 'fill_form_field':
          result = await this.cursor.typeIntoField(args.selector, args.value ?? '');
          this.memory.markOriented({ selector: args.selector, title: `Filled ${args.selector}` });
          this.memory.markOriented({ selector: '#intake-form-section', title: 'Enterprise Consultation Form' });
          break;

        case 'fill_form_batch':
          result = await this.cursor.fillFormBatch(args.fields || []);
          this.memory.markOriented({ selector: '#intake-form-section', title: `Batch filled ${result.filledCount} fields` });
          break;

        case 'scroll_page':
          result = await this.cursor.scroll(
            args.direction || 'down',
            args.targetSelector || null,
            args.amount || 'page'
          );
          if (args.targetSelector) {
            this.memory.markOriented({ selector: args.targetSelector, title: `Scrolled to ${args.targetSelector}` });
          }
          break;

        case 'swipe_or_swap':
          result = await this.cursor.swipeOrSwap(
            args.selector,
            args.action || 'next',
            args.targetValue ?? null
          );
          this.memory.markOriented({ selector: args.selector, title: `Interacted with ${args.selector}` });
          break;

        case 'navigate_route':
          result = await this._handleNavigation(args.path, args.targetSelector, args.explanation);
          break;

        case 'scan_visible_elements':
          result = {
            success: true,
            action: 'scan_visible_elements',
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
          // Always visually highlight the matched section on screen when reading content!
          const secToHighlight = args.selector || result.matchingSections?.[0]?.selector;
          if (secToHighlight) {
            await this.cursor.moveToElement(
              secToHighlight,
              true,
              result.matchingSections?.[0]?.heading || args.query || 'Reading section'
            );
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
    }

    await this._waitForDOMSettle(120);
    result.viewportSummary = this.scanner.captureStateSnapshot();

    const doneTodos = this.memory.state.todoChecklist.filter(t => t.done).map(t => t.id);
    const pendingTodos = this.memory.state.todoChecklist.filter(t => !t.done).map(t => ({ id: t.id, page: t.page, selector: t.selector, title: t.title }));

    result.sessionMemoryDigest = {
      userLanguage: this.memory.state.userLanguage,
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

    if (path.startsWith('#')) {
      const hashEl = document.querySelector(path);
      if (hashEl) {
        window.history.pushState({}, '', path);
        const res = await this.cursor.moveToElement(hashEl, true, explanation || `Section ${path}`);
        this.memory.markOriented({ selector: path, title: explanation || path });
        return res;
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
    }

    const hashPart = path.includes('#') ? `#${path.split('#')[1]}` : '';
    const currentFile = window.location.pathname.split('/').pop() || 'test-demo.html';
    const targetFile = resolvedUrl.split('#')[0].split('/').pop();

    if (targetFile === currentFile) {
      const selectorToFocus = targetSelector || hashPart || 'h1';
      const res = await this.cursor.moveToElement(
        selectorToFocus,
        true,
        explanation || `Focused ${matchedPage?.title || targetFile}`
      );
      this.memory.markOriented({ selector: selectorToFocus, title: explanation || selectorToFocus });
      return res;
    }

    const navLink = document.querySelector(`a[href*="${targetFile}"]`);
    if (navLink) {
      await this.cursor.moveToElement(navLink, true, `Redirecting to ${matchedPage?.title || targetFile}...`);
      await new Promise(r => setTimeout(r, 240));
    }

    const existingPending = [...(this.memory.state.pendingNavigationActions || [])];
    if (targetSelector || hashPart) {
      existingPending.unshift({
        name: 'move_and_highlight',
        args: {
          selector: targetSelector || hashPart,
          explanation: explanation || `Arrived at ${targetSelector || hashPart}`
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

  _waitForDOMSettle(maxWaitMs = 120) {
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

  /**
   * Automatically restores the active Gemini Live voice session AND executes any queued
   * actions after a cross-page redirect OR a hard browser refresh (`F5` / `Cmd+R`).
   */
  _checkRestoredSession() {
    const runRestore = async () => {
      const memState = this.memory.getState();

      // 1. If the Live Voice session was active before the page redirect or refresh, reconnect automatically!
      if (memState.isLiveActive && memState.liveEndpoint && !this.client) {
        this.options.endpoint = memState.liveEndpoint;
        try {
          await this.start();
          this._emit('sessionRestored', {
            sessionId: memState.sessionId,
            language: memState.userLanguage
          });
        } catch (err) {
          console.warn('[WebOrient] Auto-reconnect after refresh/redirect skipped:', err);
        }
      }

      // 2. Execute any queued post-navigation DOM actions
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

  _mountFloatingLauncher() {
    if (document.getElementById('weborient-floating-launcher')) return;
    const launcher = document.createElement('div');
    launcher.id = 'weborient-floating-launcher';
    launcher.setAttribute('data-agent-ignore', 'true');
    launcher.style.cssText = `
      position: fixed; bottom: 20px; left: 20px; z-index: 2147483640;
      display: flex; gap: 8px; align-items: center;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    `;
    launcher.innerHTML = `
      <button id="wo-launcher-live" style="
        background: linear-gradient(135deg, ${this.options.themeColor}, ${this.options.accentColor});
        color: #fff; border: none; padding: 10px 16px; border-radius: 999px;
        font-size: 12px; font-weight: 700; cursor: pointer;
        box-shadow: 0 8px 24px rgba(99, 102, 241, 0.4);
      ">🎙️ Talk to Live Co-Pilot</button>
    `;
    document.body.appendChild(launcher);
    launcher.querySelector('#wo-launcher-live').addEventListener('click', () => {
      if (this.client) {
        this.stop();
      } else {
        this.start();
      }
    });
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
  }
}

if (typeof window !== 'undefined') {
  window.WebOrient = WebOrient;

  const currentScript = document.currentScript;
  if (currentScript && (currentScript.dataset.endpoint || currentScript.dataset.siteId)) {
    window.weborientInstance = new WebOrient({
      endpoint: currentScript.dataset.endpoint || null,
      siteId: currentScript.dataset.siteId || 'client_default',
      themeColor: currentScript.dataset.themeColor || '#6366f1',
      accentColor: currentScript.dataset.accentColor || '#ec4899',
      manifestUrl: currentScript.dataset.manifest || null,
      autoMountLauncher: currentScript.dataset.autoMount !== 'false'
    });
  }
}


window.WebOrient = WebOrient;
window.SUPPORTED_LANGUAGES = SUPPORTED_LANGUAGES;
})(window);
