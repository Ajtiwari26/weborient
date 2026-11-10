/**
 * WebOrient Cross-Page Session Memory Engine (`src/sdk/session-memory.js`)
 * Maintains consistent state across hard multi-page navigations and SPA route changes:
 * 1. What has already been oriented (`orientedHistory`: pages, sections, selectors, timestamps)
 * 2. What else remains to be described (`pendingToDescribe`: ordered pitch/walkthrough queue)
 * 3. What the user wants (`userIntent`: goal, industry, budget/tier preference, questions asked)
 * 4. Native language of the user (`userLanguage`: code, label, voice locale, auto-detected or chosen)
 * 5. Collected form facts (`formFacts`: remembered name, email, company, teamSize across pages)
 */

const MEMORY_STORAGE_KEY = 'weborient_consistent_memory_v3';

export const SUPPORTED_LANGUAGES = {
  'en-IN': { code: 'en-IN', name: 'English (India / Global)', voiceLang: 'en-IN', fallbackLang: 'en-US' },
  'hi-IN': { code: 'hi-IN', name: 'Hindi (हिन्दी)', voiceLang: 'hi-IN', fallbackLang: 'hi' },
  'hinglish': { code: 'hinglish', name: 'Hinglish (Hindi + English)', voiceLang: 'en-IN', fallbackLang: 'hi-IN' },
  'en-US': { code: 'en-US', name: 'English (US)', voiceLang: 'en-US', fallbackLang: 'en' },
  'es-ES': { code: 'es-ES', name: 'Español (Spanish)', voiceLang: 'es-ES', fallbackLang: 'es' },
  'fr-FR': { code: 'fr-FR', name: 'Français (French)', voiceLang: 'fr-FR', fallbackLang: 'fr' }
};

export class SessionMemory {
  constructor(options = {}) {
    this.storageKey = options.storageKey || MEMORY_STORAGE_KEY;
    this.onChange = options.onChange || (() => {});
    this.state = this._loadOrInitialize(options);
  }

  _loadOrInitialize(options = {}) {
    try {
      const raw = sessionStorage.getItem(this.storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.sessionId) {
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
      userLanguage: options.defaultLanguage || initialLang,
      userIntent: {
        goal: options.defaultGoal || 'Evaluate WebOrient for customer onboarding & voice form completion',
        interestedTier: 'Pro Co-Pilot',
        customNotes: []
      },
      visitedPages: [],
      orientedHistory: [],
      pendingToDescribe: [
        { page: 'test-demo.html', selector: '#hero-section', title: 'Platform Overview & Live Telemetry' },
        { page: 'test-demo.html', selector: '#workflow-section', title: '4-Stage Closed-Loop Architecture' },
        { page: 'features.html', selector: '#subsystem-tabs-section', title: '5-Layer Deep Runtime & Bézier Engine' },
        { page: 'features.html', selector: '#benchmark-section', title: '310ms Latency Benchmark vs Chatbots' },
        { page: 'pricing.html', selector: '#pricing-tiers-section', title: 'Pricing Plans & 20% Annual Toggle' },
        { page: 'pricing.html', selector: '#roi-calculator-section', title: 'Interactive Revenue Lift Calculator' },
        { page: 'docs.html', selector: '#quickstart-section', title: '2-Minute Client Script Installation' },
        { page: 'contact.html', selector: '#intake-form-section', title: '11-Field Voice Consultation Form' }
      ],
      activePitchQueue: [],
      isPitchRunning: false,
      formFacts: {
        fullName: 'Ajay Tiwari',
        email: 'ajay@deploymate.in',
        phone: '+91 98765 43210',
        company: 'DeployMate AI Labs',
        website: 'https://deploymate.in',
        framework: 'Next.js / React',
        plan: 'Pro Co-Pilot',
        teamSize: '65'
      }
    };

    this._persist(freshState);
    return freshState;
  }

  _persist(nextState = this.state) {
    nextState.updatedAt = Date.now();
    this.state = nextState;
    try {
      sessionStorage.setItem(this.storageKey, JSON.stringify(nextState));
    } catch (_) {}
    this.onChange(this.state);
  }

  getState() {
    return this.state;
  }

  /**
   * Records that a specific page was visited
   */
  recordPageVisit(pageFile, pageTitle) {
    const cleanFile = String(pageFile || '').split('/').pop() || 'test-demo.html';
    if (!this.state.visitedPages.includes(cleanFile)) {
      this.state.visitedPages.push(cleanFile);
      this._persist();
    }
    return this.state;
  }

  /**
   * Records that an element or section has been visually oriented & explained to the user,
   * and removes it from `pendingToDescribe` so the agent knows what is done vs. what's left.
   */
  markOriented({ page, selector, title, explanation }) {
    const currentFile = page || (typeof window !== 'undefined' ? window.location.pathname.split('/').pop() : 'test-demo.html');
    const key = `${currentFile}::${selector}`;

    const existingIdx = this.state.orientedHistory.findIndex(item => item.key === key);
    const entry = {
      key,
      page: currentFile,
      selector,
      title: title || selector,
      explanation: explanation || null,
      timestamp: Date.now()
    };

    if (existingIdx >= 0) {
      this.state.orientedHistory[existingIdx] = entry;
    } else {
      this.state.orientedHistory.push(entry);
    }

    // Remove matching item from pendingToDescribe
    this.state.pendingToDescribe = this.state.pendingToDescribe.filter(
      item => !(item.page === currentFile && item.selector === selector) && item.selector !== selector
    );

    this._persist();
    return entry;
  }

  /**
   * Checks if a selector on the current page was already oriented
   */
  hasBeenOriented(selector, page = null) {
    const currentFile = page || (typeof window !== 'undefined' ? window.location.pathname.split('/').pop() : 'test-demo.html');
    return this.state.orientedHistory.some(item => item.page === currentFile && item.selector === selector);
  }

  /**
   * Updates user's native language preference
   */
  setLanguage(langCode) {
    if (SUPPORTED_LANGUAGES[langCode]) {
      this.state.userLanguage = langCode;
    } else {
      this.state.userLanguage = langCode || 'en-IN';
    }
    this._persist();
    return this.getLanguageConfig();
  }

  getLanguageConfig() {
    return SUPPORTED_LANGUAGES[this.state.userLanguage] || SUPPORTED_LANGUAGES['en-IN'];
  }

  /**
   * Updates what the user wants (goal, interested tier, or custom preference notes)
   */
  updateUserIntent({ goal, interestedTier, note, language, addPendingTopic, formFactPatch }) {
    if (goal) this.state.userIntent.goal = goal;
    if (interestedTier) this.state.userIntent.interestedTier = interestedTier;
    if (note && !this.state.userIntent.customNotes.includes(note)) {
      this.state.userIntent.customNotes.push(note);
    }
    if (language) {
      this.setLanguage(language);
    }
    if (addPendingTopic && addPendingTopic.selector) {
      this.state.pendingToDescribe.unshift({
        page: addPendingTopic.page || (typeof window !== 'undefined' ? window.location.pathname.split('/').pop() : 'test-demo.html'),
        selector: addPendingTopic.selector,
        title: addPendingTopic.title || addPendingTopic.selector
      });
    }
    if (formFactPatch && typeof formFactPatch === 'object') {
      Object.assign(this.state.formFacts, formFactPatch);
    }
    this._persist();
    return this.state;
  }

  /**
   * Stores or pops steps from the multi-page autonomous salesperson pitch queue
   */
  setPitchQueue(steps = [], isRunning = true) {
    this.state.activePitchQueue = Array.isArray(steps) ? steps : [];
    this.state.isPitchRunning = Boolean(isRunning && this.state.activePitchQueue.length > 0);
    this._persist();
  }

  shiftNextPitchStep() {
    if (!Array.isArray(this.state.activePitchQueue) || this.state.activePitchQueue.length === 0) {
      this.state.isPitchRunning = false;
      this._persist();
      return null;
    }
    const next = this.state.activePitchQueue.shift();
    if (this.state.activePitchQueue.length === 0) {
      this.state.isPitchRunning = false;
    }
    this._persist();
    return next;
  }

  stopPitch() {
    this.state.activePitchQueue = [];
    this.state.isPitchRunning = false;
    this._persist();
  }

  /**
   * Generates a structured context summary injected into Gemini Live on page load or tool response
   */
  buildModelContextSummary() {
    const langCfg = this.getLanguageConfig();
    const orientedList = this.state.orientedHistory
      .slice(-8)
      .map(i => `${i.page}:${i.selector} (${i.title})`)
      .join(', ') || 'None yet';

    const pendingList = this.state.pendingToDescribe
      .slice(0, 6)
      .map(i => `${i.page}:${i.selector} (${i.title})`)
      .join(', ') || 'All primary sections covered';

    return [
      `[SESSION MEMORY (${this.state.sessionId})]`,
      `- User Native Language: ${langCfg.name} (${langCfg.code}) -> Speak & explain in this language/style.`,
      `- User Goal / Want: ${this.state.userIntent.goal} (Interested Tier: ${this.state.userIntent.interestedTier})`,
      `- Pages Visited So Far: ${this.state.visitedPages.join(' -> ') || 'Current page'}`,
      `- Already Oriented / Explained (DO NOT repeat unless asked): ${orientedList}`,
      `- What Else Remains to Describe Next: ${pendingList}`,
      `- Remembered User Form Profile: ${JSON.stringify(this.state.formFacts)}`
    ].join('\n');
  }

  reset() {
    try {
      sessionStorage.removeItem(this.storageKey);
    } catch (_) {}
    this.state = this._loadOrInitialize();
    return this.state;
  }
}
