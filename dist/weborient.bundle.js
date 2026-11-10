/**
 * WebOrient Drop-In Single-File Bundle (v0.3.0)
 * Generated automatically by scripts/bundle.js
 * Includes: SessionMemory, SpeechSyncEngine, DOMScanner, GhostCursor, LiveClient, WebOrient
 */
(function(window) {
'use strict';

// --- MODULE: session-memory.js ---
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

const SUPPORTED_LANGUAGES = {
  'en-IN': { code: 'en-IN', name: 'English (India / Global)', voiceLang: 'en-IN', fallbackLang: 'en-US' },
  'hi-IN': { code: 'hi-IN', name: 'Hindi (हिन्दी)', voiceLang: 'hi-IN', fallbackLang: 'hi' },
  'hinglish': { code: 'hinglish', name: 'Hinglish (Hindi + English)', voiceLang: 'en-IN', fallbackLang: 'hi-IN' },
  'en-US': { code: 'en-US', name: 'English (US)', voiceLang: 'en-US', fallbackLang: 'en' },
  'es-ES': { code: 'es-ES', name: 'Español (Spanish)', voiceLang: 'es-ES', fallbackLang: 'es' },
  'fr-FR': { code: 'fr-FR', name: 'Français (French)', voiceLang: 'fr-FR', fallbackLang: 'fr' }
};

class SessionMemory {
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


// --- MODULE: speech-sync.js ---
/**
 * WebOrient Synchronized Show & Describe Engine (`src/sdk/speech-sync.js`)
 * Ensures "showing & saying are 100% in sync" like a live human salesperson:
 * - Coordinates Ghost Cursor arrival, visual spotlight/caption, and voice narration beat-by-beat
 * - Supports native Web Speech API (`window.speechSynthesis`) in the user's preferred language
 *   (English, Hindi, Hinglish, Spanish, French) AND Gemini Live 24kHz audio playback gating
 * - Emits word/sentence boundary events so the cursor can perform micro-emphases while speaking
 */
class SpeechSyncEngine {
  constructor(options = {}) {
    this.memory = options.memory || null;
    this.onSpeechStart = options.onSpeechStart || (() => {});
    this.onSpeechWord = options.onSpeechWord || (() => {});
    this.onSpeechEnd = options.onSpeechEnd || (() => {});
    this.isSpeaking = false;
    this.muted = false;
    this._currentUtterance = null;
    this._resolveCurrentSpeech = null;
  }

  /**
   * Speaks `text` in the user's native language and resolves ONLY when the spoken line completes,
   * keeping cursor movements and page transitions locked in step with speech.
   */
  async speakSynchronized(text, options = {}) {
    if (!text) return;
    this.stop();

    const langConfig = this.memory ? this.memory.getLanguageConfig() : { voiceLang: 'en-IN', fallbackLang: 'en-US' };
    const targetLang = options.lang || langConfig.voiceLang || 'en-IN';

    this.isSpeaking = true;
    this.onSpeechStart(text, targetLang);

    // If muted or speechSynthesis unavailable, simulate natural reading cadence (~55ms per char)
    if (this.muted || typeof window === 'undefined' || !('speechSynthesis' in window)) {
      const readingMs = Math.min(4200, Math.max(1100, text.length * 42));
      await new Promise(r => {
        this._resolveCurrentSpeech = r;
        setTimeout(r, readingMs);
      });
      this.isSpeaking = false;
      this.onSpeechEnd(text);
      return;
    }

    return new Promise(resolve => {
      this._resolveCurrentSpeech = resolve;
      let finished = false;

      const finish = () => {
        if (finished) return;
        finished = true;
        this.isSpeaking = false;
        this._currentUtterance = null;
        this._resolveCurrentSpeech = null;
        this.onSpeechEnd(text);
        resolve();
      };

      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        this._currentUtterance = utterance;

        const voices = window.speechSynthesis.getVoices() || [];
        const matchedVoice =
          voices.find(v => v.lang === targetLang) ||
          voices.find(v => v.lang.startsWith(targetLang.split('-')[0])) ||
          voices.find(v => v.lang.startsWith(langConfig.fallbackLang?.split('-')[0] || 'en')) ||
          voices[0];

        if (matchedVoice) {
          utterance.voice = matchedVoice;
          utterance.lang = matchedVoice.lang;
        } else {
          utterance.lang = targetLang;
        }

        utterance.rate = options.rate || 1.04;
        utterance.pitch = options.pitch || 1.0;

        utterance.onboundary = (event) => {
          if (event.name === 'word') {
            this.onSpeechWord(event.charIndex, text);
          }
        };

        utterance.onend = finish;
        utterance.onerror = finish;

        // Safety watchdog in case browser TTS hangs on background tab
        const maxTimeout = Math.min(12000, Math.max(2200, text.length * 85));
        setTimeout(finish, maxTimeout);

        window.speechSynthesis.speak(utterance);
      } catch (_) {
        finish();
      }
    });
  }

  /**
   * Immediately halts any active speech (for user barge-in or tour cancellation)
   */
  stop() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch (_) {}
    }
    this.isSpeaking = false;
    this._currentUtterance = null;
    if (this._resolveCurrentSpeech) {
      const r = this._resolveCurrentSpeech;
      this._resolveCurrentSpeech = null;
      r();
    }
  }
}

/**
 * Multilingual Salesperson Script Dictionary
 * Provides localized "Show & Describe Simultaneously" salesperson lines in:
 * - English (`en-IN` / `en-US`)
 * - Hinglish (`hinglish` — natural Indian startup salesperson blend)
 * - Hindi (`hi-IN`)
 * - Spanish (`es-ES`)
 */
const SALESPERSON_SCRIPTS = {
  'en-IN': {
    hero: (goal) => `Welcome! I see your goal is "${goal}". Let me show you our live telemetry—310 millisecond voice latency and a 42 percent lift in form conversions.`,
    workflow: () => `Here is how our 4-stage closed-loop engine works. Watch as I swap to the Bézier Actuation tab while explaining it.`,
    navFeatures: () => `Now let's head over to the Architecture page so I can show you the 5-layer engine and latency benchmarks.`,
    featuresTab: () => `We are now on the Architecture page, and I remember we already covered the overview. Let's inspect Layer 2: our 60fps Cubic Bézier Ghost Cursor.`,
    featuresSwipe: () => `Let me swipe through our industry deployment blueprints so you can see real production use cases.`,
    navPricing: () => `Next, let's jump to the Pricing and ROI Calculator page to model your exact conversion lift.`,
    pricingToggle: () => `Watch me flip the billing switch to Annual—that immediately saves you 20 percent, bringing Pro Co-Pilot down to 64 dollars a month.`,
    pricingRoi: () => `I'm setting your monthly traffic slider to 75,000 visitors—generating an estimated 108,000 dollars per month in additional revenue.`,
    navContact: () => `Finally, let's go to the Enterprise Intake page and fill out your consultation form automatically using your remembered profile.`,
    contactFill: (name, company) => `I am filling in your details for ${name} at ${company}, selecting Next.js and Pro Co-Pilot, and enabling Priority Onboarding.`,
    contactDone: () => `All 11 fields are filled and validated, while your password field stayed completely untouched. Shall I submit this for you?`
  },
  'hinglish': {
    hero: (goal) => `Namaste! Aapka goal hai "${goal}". Dekhiye yahan live metrics mein—sirf 310 millisecond latency hai aur form conversion 42 percent badh jata hai.`,
    workflow: () => `Ab dekhiye hamara 4-stage engine kaise kaam karta hai—main saath-saath tab switch karke aapko Bézier Cursor dikha raha hoon.`,
    navFeatures: () => `Chaliye ab Architecture page par chalte hain jahan main aapko 5-layer runtime aur benchmarks dikhaunga.`,
    featuresTab: () => `Hum Architecture page par aa gaye hain, aur mujhe yaad hai humne overview dekh liya hai. Yeh dekhiye Layer 2: 60fps Cubic Bézier Ghost Cursor.`,
    featuresSwipe: () => `Main is carousel ko swipe kar raha hoon taaki aap FinTech aur E-Commerce use cases dekh sakein.`,
    navPricing: () => `Ab chaliye Pricing aur ROI Calculator page par chalte hain aapki savings calculate karne ke liye.`,
    pricingToggle: () => `Dekhiye, maine Annual billing switch on kar diya—isse aapko seedha 20 percent discount milta hai aur Pro plan 64 dollars per month ho gaya.`,
    pricingRoi: () => `Main traffic slider ko 75,000 visitors par set kar रहा hoon—jisse har mahine lagbhag 108,000 dollars ki extra revenue lift milti hai.`,
    navContact: () => `Ab aakhri step mein Enterprise Contact page par chalte hain aur aapka form automatically fill karte hain.`,
    contactFill: (name, company) => `Main ${name} aur ${company} ki details type kar raha hoon, Next.js aur Pro Co-Pilot select kiya, aur Priority Onboarding tick kar diya.`,
    contactDone: () => `Poora form fill aur validate ho gaya hai, aur password field bilkul safe hai. Kya main isse submit kar doon?`
  },
  'hi-IN': {
    hero: (goal) => `नमस्ते! आपका लक्ष्य "${goal}" है। यहाँ हमारे लाइव मेट्रिक्स देखिए—केवल 310 मिलीसेकंड की लेटेंसी और 42 प्रतिशत अधिक फॉर्म कन्वर्ज़न।`,
    workflow: () => `यहाँ देखिए हमारा 4-स्टेज इंजन कैसे काम करता है। मैं बोलते हुए साथ में टैब बदल कर आपको दिखा रहा हूँ।`,
    navFeatures: () => `चलिए अब आर्किटेक्चर पेज पर चलते हैं जहाँ हम 5-लेयर इंजन और बेंचमार्क देखेंगे।`,
    featuresTab: () => `हम आर्किटेक्चर पेज पर आ गए हैं। हमें याद है कि हमने होम पेज देख लिया है, अब लेयर 2 का घोस्ट कर्सर देखिए।`,
    featuresSwipe: () => `मैं इस कैरोसेल को स्वाइप कर रहा हूँ ताकि आप अलग-अलग इंडस्ट्री के उदाहरण देख सकें।`,
    navPricing: () => `अब प्राइसिंग और आरओआई कैलकुलेटर पेज पर चलते हैं।`,
    pricingToggle: () => `देखिए, मैंने एनुअल बिलिंग स्विच ऑन कर दिया है—इससे आपको तुरंत 20 प्रतिशत की बचत मिलती है।`,
    pricingRoi: () => `मैं ट्रैफ़िक स्लाइडर को 75,000 विज़िटर्स पर सेट कर रहा हूँ, जिससे हर महीने बड़ी रेवेन्यू वृद्धि होती है।`,
    navContact: () => `अब कॉन्टैक्ट पेज पर चलते हैं और आपकी याद रखी गई जानकारी से पूरा फॉर्म भरते हैं।`,
    contactFill: (name, company) => `मैं ${name} और ${company} का विवरण भर रहा हूँ, और सभी विकल्प चुन रहा हूँ।`,
    contactDone: () => `सभी फ़ील्ड भर दिए गए हैं और पासवर्ड सुरक्षित है। क्या मैं इसे सबमिट कर दूँ?`
  },
  'es-ES': {
    hero: (goal) => `¡Bienvenido! Veo que tu objetivo es "${goal}". Mira nuestras métricas en vivo: 310 milisegundos de latencia y un 42 por ciento más de conversión.`,
    workflow: () => `Así funciona nuestro motor de 4 etapas. Observa cómo cambio a la pestaña del cursor Bézier mientras te lo explico.`,
    navFeatures: () => `Ahora vayamos a la página de Arquitectura para mostrarte las 5 capas y las comparativas de velocidad.`,
    featuresTab: () => `Ya estamos en Arquitectura y recuerdo lo que vimos antes. Aquí tienes la Capa 2: nuestro Ghost Cursor a 60 cuadros por segundo.`,
    featuresSwipe: () => `Deslizaré este carrusel para mostrarte casos de uso en FinTech y comercio electrónico.`,
    navPricing: () => `Vamos a la página de Precios y Calculadora ROI para calcular tu retorno de inversión.`,
    pricingToggle: () => `Mira cómo activo la facturación anual: ahorras un 20 por ciento al instante, dejando el plan Pro en 64 dólares al mes.`,
    pricingRoi: () => `Ajusto el deslizador a 75,000 visitantes mensuales, proyectando 108,000 dólares adicionales por mes.`,
    navContact: () => `Por último, vayamos a la página de Contacto Empresarial para completar tu formulario automáticamente.`,
    contactFill: (name, company) => `Estoy rellenando los datos de ${name} en ${company}, seleccionando Next.js y el plan Pro.`,
    contactDone: () => `Los 11 campos están listos y validados. ¿Te gustaría que envíe el formulario ahora?`
  }
};


// --- MODULE: dom-scanner.js ---
/**
 * WebOrient DOM Scanner & Semantic Grounding Engine (v0.2.0)
 * - Assigns persistent deterministic `data-wo-id` attributes to actionable & landmark elements
 * - Resolves selectors, data-wo-id, or natural accessible labels to live DOM elements
 * - Extracts structured page content, headings, pricing cards, FAQs, and tables for Q&A
 * - Detects interactive widgets: forms, tabs, carousels, toggle switches, and scrollable containers
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
      '#weborient-overlay *'
    ];
    this._idCounter = 1;
  }

  /**
   * Resolves a selector, data-wo-id, element ID, or accessible label to a DOM element
   */
  resolveElement(target) {
    if (!target) return null;
    if (target instanceof Element) return target;

    const raw = String(target).trim();
    if (!raw) return null;

    // 1. Direct data-wo-id shorthand (e.g. "wo-12")
    if (/^wo-\d+$/i.test(raw)) {
      const byWo = document.querySelector(`[data-wo-id="${raw.toLowerCase()}"]`);
      if (byWo && !this._isIgnored(byWo)) return byWo;
    }

    // 2. Try standard CSS selector
    try {
      const el = document.querySelector(raw);
      if (el && !this._isIgnored(el)) return el;
    } catch (_) {
      // Not a valid CSS selector; continue to semantic resolution
    }

    // 3. Try bare ID without '#'
    if (!raw.startsWith('#') && !raw.includes(' ')) {
      const byId = document.getElementById(raw);
      if (byId && !this._isIgnored(byId)) return byId;
    }

    // 4. Search across open Shadow DOM roots for CSS selector
    const shadowMatch = this._queryShadowRoots(raw);
    if (shadowMatch && !this._isIgnored(shadowMatch)) return shadowMatch;

    // 5. Fuzzy match by accessible label, placeholder, name, or visible text
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
      } else if (label.includes(needle) || needle.includes(label) && label.length > 2) {
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

        // Include current value/state for form controls & toggles
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

  /**
   * Extracts semantic page content, sections, headings, FAQs, pricing cards, and manifest knowledge
   * so the agent can answer any question accurately.
   */
  readPageContent(options = {}) {
    const query = (options.query || '').trim().toLowerCase();
    const targetSelector = options.selector || '';
    const manifest = options.manifest || null;

    // If a specific selector was requested, extract detailed content from that node
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

    // Collect semantic sections across the document
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

    // Match manifest knowledgeBase and page definitions if available
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

  /**
   * Captures a lightweight snapshot of the active viewport and widget state for closed-loop verification
   */
  captureStateSnapshot() {
    const visibleInteractive = this.scan({ includeOffscreen: false });
    const invalidFields = visibleInteractive
      .filter(item => item.valid === false)
      .map(item => ({
        selector: item.selector,
        label: item.label,
        validationMessage: item.validationMessage
      }));

    // Determine which section is most centered in the viewport
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
      // Consider visible if within or near viewport
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
    return el.getAttribute('aria-label') || el.id || 'Section';
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
 * WebOrient Live Client (v0.2.0)
 * - Captures 16kHz mono PCM microphone audio (AudioWorklet with ScriptProcessor fallback)
 * - Decodes and plays 24kHz Int16 PCM model audio streams gaplessly via Web Audio API
 * - Instant barge-in cancellation (<50ms) stopping all active AudioBufferSourceNodes
 * - Routes asynchronous tool calls and sends named FunctionResponse payloads
 */
class LiveClient {
  constructor(options = {}) {
    this.endpoint = options.endpoint || 'ws://localhost:8088';
    this.onToolCall = options.onToolCall || (() => {});
    this.onStatusChange = options.onStatusChange || (() => {});
    this.onTranscript = options.onTranscript || (() => {});
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

  /**
   * Starts microphone capture and connects to the WebOrient WebSocket Relay
   */
  async connect() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    this.captureContext = new AudioCtx({ sampleRate: 16000 });
    this.playbackContext = new AudioCtx({ sampleRate: 24000 });

    if (this.captureContext.state === 'suspended') {
      await this.captureContext.resume();
    }
    if (this.playbackContext.state === 'suspended') {
      await this.playbackContext.resume();
    }

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
    const silenceGain = this.captureContext.createGain();
    silenceGain.gain.value = 0;
    silenceGain.connect(this.captureContext.destination);

    // Prefer low-latency AudioWorklet when supported
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
        this.workletNode.connect(silenceGain);
        return;
      } catch (err) {
        console.warn('[WebOrient] AudioWorklet fallback to ScriptProcessor:', err);
      }
    }

    // Fallback: ScriptProcessorNode
    this.scriptProcessor = this.captureContext.createScriptProcessor(4096, 1, 1);
    this.scriptProcessor.onaudioprocess = (e) => {
      const inputData = e.inputBuffer.getChannelData(0);
      this._sendFloat32AudioFrame(inputData);
    };
    source.connect(this.scriptProcessor);
    this.scriptProcessor.connect(silenceGain);
  }

  _sendFloat32AudioFrame(float32Array) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const pcm16 = this._floatTo16BitPCM(float32Array);
    const base64 = this._arrayBufferToBase64(pcm16.buffer);

    if (!this._sentFrames) this._sentFrames = 0;
    this._sentFrames++;
    if (this._sentFrames % 50 === 0) {
      console.log(`[WebOrient] Captured & sent ${this._sentFrames} mic audio chunks`);
    }

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

    // 2. Play incoming 24kHz PCM audio chunks & forward text transcripts
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

    if (msg.serverContent?.inputTranscription?.text) {
      this.onTranscript(msg.serverContent.inputTranscription.text, 'user');
    }

    if (msg.serverContent?.outputTranscription?.text) {
      this.onTranscript(msg.serverContent.outputTranscription.text, 'model');
    }

    // 3. Handle model tool calls
    if (msg.toolCall?.functionCalls) {
      for (const call of msg.toolCall.functionCalls) {
        this.onToolCall(call.name, call.args || {}, call.id);
      }
    }
  }

  /**
   * Decodes Base64 16-bit PCM into Float32 and schedules gapless playback on playbackContext
   */
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
    this.isPlaying = true;

    this.activeSourceNodes.add(sourceNode);
    sourceNode.onended = () => {
      this.activeSourceNodes.delete(sourceNode);
      if (this.activeSourceNodes.size === 0) {
        this.isPlaying = false;
      }
    };
  }

  /**
   * Immediately halts all scheduled and currently playing audio buffers on barge-in
   */
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
    this.isPlaying = false;
  }

  /**
   * Sends structured tool execution output back to Gemini Live session
   */
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

  /**
   * Sends a text message or context update into the active Gemini Live session
   */
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
    const alignedLen = Math.floor(binary.length / 2) * 2;
    const bytes = new Uint8Array(alignedLen);
    for (let i = 0; i < alignedLen; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Int16Array(bytes.buffer, 0, alignedLen / 2);
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
 * WebOrient: Autonomous Voice Co-Browsing, Session-Aware Memory & Synchronized Salesperson SDK (v0.3.0)
 * - Persistent Cross-Page Session Memory (`SessionMemory`: what has been oriented, what remains to describe,
 *   what the user wants, user's native language, and remembered form profile)
 * - Synchronized "Show & Describe Simultaneously" Salesperson Engine (`SpeechSyncEngine` + `GhostCursor`)
 * - Complete 12-Tool Router with Closed-Loop Act -> Settle -> Diff -> Respond verification
 */





const SESSION_STORAGE_KEY = 'weborient_session_state_v2';

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
      onChange: (memState) => this._emit('memoryUpdate', memState)
    });

    this.speechSync = new SpeechSyncEngine({
      memory: this.memory,
      onSpeechStart: (text, lang) => {
        this.cursor.showSpeechBubble(text, `Salesperson (${lang})`);
        this._emit('speechSync', { status: 'speaking', text, lang });
      },
      onSpeechEnd: (text) => {
        this.cursor.hideSpeechBubble();
        this._emit('speechSync', { status: 'done', text });
      }
    });

    this.client = null;
    this.manifest = null;
    this._pitchAborted = false;

    // Record current page visit in cross-page session memory
    if (typeof window !== 'undefined') {
      const currentFile = window.location.pathname.split('/').pop() || 'test-demo.html';
      this.memory.recordPageVisit(currentFile, document.title);
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
   * Connects microphone audio and starts the live co-browsing session,
   * injecting full cross-page Session Memory into the Gemini Live session.
   */
  async start() {
    if (!this.options.endpoint) {
      console.warn('[WebOrient] No WebSocket endpoint provided. Running in local interactive mode.');
      return;
    }

    // Append sessionId and siteId query params so the Relay Server links cross-page state
    const sep = this.options.endpoint.includes('?') ? '&' : '?';
    const wsUrl = `${this.options.endpoint}${sep}siteId=${encodeURIComponent(this.options.siteId)}&sessionId=${encodeURIComponent(this.memory.state.sessionId)}&lang=${encodeURIComponent(this.memory.state.userLanguage)}`;

    this.client = new LiveClient({
      endpoint: wsUrl,
      onToolCall: (name, args, callId) => this.handleToolCall(name, args, callId),
      onStatusChange: (status) => {
        console.log(`[WebOrient] Status: ${status}`);
        this._emit('status', { status });
      },
      onTranscript: (text, role) => {
        this.cursor.showSpeechBubble(text, 'Live Voice AI');
        this._emit('transcript', { text, role });
      },
      onInterrupted: () => {
        this.stopSalespersonDemo();
        this.cursor.cancelActiveActions();
        this._emit('interrupted', {});
      }
    });

    await this.client.connect();
    this._updateSessionStorage({ connected: true, endpoint: this.options.endpoint, timestamp: Date.now() });

    // Send initial page + cross-page Session Memory context so Gemini knows what was already oriented
    const initialSnapshot = this.scanner.captureStateSnapshot();
    const initialElements = this.scanner.scan({ includeOffscreen: false }).slice(0, 25);
    const memorySummary = this.memory.buildModelContextSummary();

    this.client.sendText(
      `${memorySummary}\n[ACTIVE PAGE VIEWPORT: "${document.title}" (${initialSnapshot.url}), activeSection=${initialSnapshot.activeSection || 'top'}, visibleControls=${JSON.stringify(initialElements.map(e => ({ selector: e.selector, label: e.label, tag: e.tag })))}]`
    );
  }

  /**
   * Synchronized "Show & Describe Simultaneously" action:
   * Moves the Ghost Cursor to `selector`, highlights it with an explanation badge,
   * optionally performs an inline action (tab swap, toggle, swipe, form fill),
   * and simultaneously narrates `spokenText` in the user's native language!
   */
  async showAndDescribe({ selector, spokenText, explanation, inlineAction = null }) {
    const labelText = explanation || spokenText || 'Showing section';
    const moveRes = await this.cursor.moveToElement(selector, true, labelText);

    // Record in cross-page Session Memory so we know this element has been oriented
    this.memory.markOriented({
      selector,
      title: moveRes.label || labelText.slice(0, 50),
      explanation: spokenText || labelText
    });

    // Start speaking and executing any inline gesture/action simultaneously!
    const speechPromise = spokenText
      ? this.speechSync.speakSynchronized(spokenText)
      : Promise.resolve();

    const gesturePromise = (async () => {
      if (inlineAction && inlineAction.type) {
        await new Promise(r => setTimeout(r, 250));
        if (inlineAction.type === 'swipe_or_swap') {
          await this.cursor.swipeOrSwap(
            inlineAction.selector || selector,
            inlineAction.action || 'next',
            inlineAction.targetValue ?? null
          );
        } else if (inlineAction.type === 'fill_form_field') {
          await this.cursor.typeIntoField(
            inlineAction.selector || selector,
            inlineAction.value ?? ''
          );
        } else if (inlineAction.type === 'fill_form_batch') {
          await this.cursor.fillFormBatch(inlineAction.fields || []);
        } else if (inlineAction.type === 'click_element') {
          await this.cursor.click(inlineAction.selector || selector, labelText);
        }
      } else if (moveRes.element) {
        await this.cursor.performSpeakingGesture(moveRes.element);
      }
    })();

    await Promise.all([speechPromise, gesturePromise]);

    return {
      success: moveRes.success,
      action: 'show_and_describe',
      selector,
      spokenText,
      memoryState: {
        orientedCount: this.memory.state.orientedHistory.length,
        remainingCount: this.memory.state.pendingToDescribe.length
      }
    };
  }

  /**
   * Launches or resumes the Autonomous Multi-Page Synchronized Salesperson Pitch!
   * Dynamically adapts based on current page, `orientedHistory` (skips already-oriented sections
   * unless `restart: true`), `userIntent.goal`, and `userLanguage` (`en-IN`, `hinglish`, `hi-IN`, `es-ES`).
   */
  async startSalespersonDemo(options = {}) {
    this._pitchAborted = false;
    if (options.language) this.memory.setLanguage(options.language);
    if (options.goal) this.memory.updateUserIntent({ goal: options.goal });
    if (options.restart) {
      const savedLang = this.memory.state.userLanguage;
      const savedGoal = this.memory.state.userIntent.goal;
      this.memory.reset();
      this.memory.setLanguage(savedLang);
      this.memory.updateUserIntent({ goal: savedGoal });
    }

    const langKey = SALESPERSON_SCRIPTS[this.memory.state.userLanguage]
      ? this.memory.state.userLanguage
      : 'en-IN';
    const script = SALESPERSON_SCRIPTS[langKey];
    const goal = this.memory.state.userIntent.goal;
    const facts = this.memory.state.formFacts;

    // Full 4-page Salesperson Show-and-Tell Master Storyboard
    const allSteps = [
      // Page 1: test-demo.html
      {
        page: 'test-demo.html',
        selector: '#telemetry-strip',
        explanation: '310ms Voice Latency & +42% Conversion Lift',
        spokenText: script.hero(goal)
      },
      {
        page: 'test-demo.html',
        selector: '#workflow-tabs',
        explanation: 'Stage 3: 60fps Cubic Bézier Actuation',
        spokenText: script.workflow(),
        inlineAction: { type: 'swipe_or_swap', selector: '#workflow-tabs', action: 'select', targetValue: 'actuate' }
      },
      // Page 2: features.html
      {
        page: 'features.html',
        selector: '#subsystem-tabs',
        explanation: 'Layer 2: Cubic Bézier & Fitts-Law Cursor Physics',
        spokenText: script.featuresTab(),
        inlineAction: { type: 'swipe_or_swap', selector: '#subsystem-tabs', action: 'select', targetValue: 'bezier' }
      },
      {
        page: 'features.html',
        selector: '#industry-carousel',
        explanation: 'Swiping Industry Deployment Blueprints',
        spokenText: script.featuresSwipe(),
        inlineAction: { type: 'swipe_or_swap', selector: '#industry-carousel', action: 'next' }
      },
      // Page 3: pricing.html
      {
        page: 'pricing.html',
        selector: '#billing-toggle',
        explanation: 'Annual Billing Switch (20% Instant Discount)',
        spokenText: script.pricingToggle(),
        inlineAction: { type: 'swipe_or_swap', selector: '#billing-toggle', action: 'toggle' }
      },
      {
        page: 'pricing.html',
        selector: '#roi-calculator-section',
        explanation: 'Interactive Voice Conversion ROI Calculator',
        spokenText: script.pricingRoi(),
        inlineAction: { type: 'fill_form_field', selector: '#calc-visitors-slider', value: '75000' }
      },
      // Page 5: contact.html
      {
        page: 'contact.html',
        selector: '#contact-form',
        explanation: 'Synchronized Voice Form Filling (11 Controls)',
        spokenText: script.contactFill(facts.fullName, facts.company),
        inlineAction: {
          type: 'fill_form_batch',
          fields: [
            { selector: '#contact-name', value: facts.fullName },
            { selector: '#contact-email', value: 'ajay at deploymate dot in' },
            { selector: '#contact-phone', value: facts.phone },
            { selector: '#contact-company', value: facts.company },
            { selector: '#contact-website', value: facts.website },
            { selector: '#contact-framework', value: 'Next.js / React' },
            { selector: '#contact-plan', value: 'Pro Co-Pilot' },
            { selector: '#contact-team-size', value: facts.teamSize },
            { selector: '#contact-priority', value: 'true' },
            { selector: '#contact-hipaa', value: 'true' },
            { selector: '#contact-message', value: `Salesperson demo completed for goal: ${goal}` }
          ]
        }
      },
      {
        page: 'contact.html',
        selector: '#btn-submit-contact',
        explanation: 'All 11 Fields Validated • Awaiting User Confirmation',
        spokenText: script.contactDone()
      }
    ];

    // Filter out steps that were already oriented in this session (unless queued directly)
    const remainingSteps = options.steps || allSteps.filter(
      s => !this.memory.hasBeenOriented(s.selector, s.page)
    );

    const queue = remainingSteps.length > 0 ? remainingSteps : allSteps;
    this.memory.setPitchQueue(queue, true);
    this._emit('pitchStatus', { running: true, remaining: queue.length });

    await this._runActivePitchLoop();
  }

  async _runActivePitchLoop() {
    const currentFile = window.location.pathname.split('/').pop() || 'test-demo.html';
    const langKey = SALESPERSON_SCRIPTS[this.memory.state.userLanguage]
      ? this.memory.state.userLanguage
      : 'en-IN';
    const script = SALESPERSON_SCRIPTS[langKey];

    while (this.memory.state.isPitchRunning && !this._pitchAborted) {
      const nextStep = this.memory.state.activePitchQueue[0];
      if (!nextStep) {
        this.memory.stopPitch();
        this._emit('pitchStatus', { running: false, remaining: 0 });
        break;
      }

      // If the next pitch step is on a DIFFERENT page, narrate the transition and navigate!
      if (nextStep.page && nextStep.page !== currentFile) {
        let navSpeech = script.navFeatures();
        if (nextStep.page === 'pricing.html') navSpeech = script.navPricing();
        else if (nextStep.page === 'contact.html') navSpeech = script.navContact();

        const navLink = document.querySelector(`a[href*="${nextStep.page}"]`);
        if (navLink) {
          await this.cursor.moveToElement(navLink, true, `Next Page: ${nextStep.page}`);
        }
        await this.speechSync.speakSynchronized(navSpeech);
        if (this._pitchAborted) break;

        // Navigate to the next page; `_checkRestoredSession` will automatically resume the pitch loop!
        await this._handleNavigation(nextStep.page);
        return;
      }

      // Pop the step and execute Show & Describe simultaneously on the current page
      this.memory.shiftNextPitchStep();
      this._emit('pitchStatus', {
        running: this.memory.state.isPitchRunning,
        remaining: this.memory.state.activePitchQueue.length,
        currentStep: nextStep
      });

      await this.showAndDescribe(nextStep);
      if (this._pitchAborted) break;
      await new Promise(r => setTimeout(r, 280));
    }

    this._emit('pitchStatus', { running: false, remaining: 0 });
  }

  stopSalespersonDemo() {
    this._pitchAborted = true;
    this.memory.stopPitch();
    this.speechSync.stop();
    this.cursor.cancelActiveActions();
    this._emit('pitchStatus', { running: false, remaining: 0 });
  }

  sendTextPrompt(text) {
    if (this.client) {
      this.client.sendText(text);
      return true;
    }
    return false;
  }

  queuePostNavigationActions(actions = []) {
    this._updateSessionStorage({
      pendingActions: actions,
      timestamp: Date.now()
    });
  }

  /**
   * Routes model tool calls to DOM actuators with closed-loop settle, verification & memory recording
   */
  async handleToolCall(name, args = {}, callId = null) {
    console.log(`[WebOrient] Executing Tool Call: ${name}`, args);
    this._emit('toolCall', { name, args, callId });

    let result = { success: true, action: name };

    try {
      switch (name) {
        case 'show_and_describe':
          result = await this.showAndDescribe({
            selector: args.selector,
            spokenText: args.spokenText || args.explanation,
            explanation: args.explanation || args.spokenText,
            inlineAction: args.inlineAction || null
          });
          break;

        case 'move_and_highlight':
          result = await this.cursor.moveToElement(
            args.selector,
            true,
            args.explanation || null
          );
          if (result.success) {
            this.memory.markOriented({
              selector: args.selector,
              title: result.label || args.selector,
              explanation: args.explanation
            });
          }
          break;

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
          break;

        case 'fill_form_batch':
          result = await this.cursor.fillFormBatch(args.fields || []);
          this.memory.markOriented({ selector: '#contact-form', title: `Batch filled ${result.filledCount} fields` });
          break;

        case 'scroll_page':
          result = await this.cursor.scroll(
            args.direction || 'down',
            args.targetSelector || null,
            args.amount || 'page'
          );
          break;

        case 'swipe_or_swap':
          result = await this.cursor.swipeOrSwap(
            args.selector,
            args.action || 'next',
            args.targetValue ?? null
          );
          this.memory.markOriented({ selector: args.selector, title: `Swapped/Swiped ${args.selector}` });
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
          if (args.selector) {
            await this.cursor.moveToElement(args.selector, true, args.query || 'Reading section');
            this.memory.markOriented({ selector: args.selector, title: `Read ${args.selector}` });
          }
          break;

        case 'guide_tour':
          result = await this.cursor.guideTour(args.steps || [], this.speechSync);
          break;

        case 'update_session_memory':
          this.memory.updateUserIntent({
            goal: args.goal,
            interestedTier: args.interestedTier,
            language: args.language,
            note: args.note,
            addPendingTopic: args.addPendingTopic
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
    result.sessionMemoryDigest = {
      userLanguage: this.memory.state.userLanguage,
      userGoal: this.memory.state.userIntent.goal,
      orientedCount: this.memory.state.orientedHistory.length,
      nextToDescribe: this.memory.state.pendingToDescribe.slice(0, 3)
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
        return await this.cursor.moveToElement(hashEl, true, explanation || `Navigated to ${path}`);
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
      return await this.cursor.moveToElement(
        selectorToFocus,
        true,
        explanation || `Already on ${matchedPage?.title || targetFile}`
      );
    }

    const navLink = document.querySelector(`a[href*="${targetFile}"]`);
    if (navLink) {
      await this.cursor.moveToElement(navLink, true, `Navigating to ${matchedPage?.title || targetFile}...`);
      await new Promise(r => setTimeout(r, 240));
    }

    const existingPending = this._readSessionStorage().pendingActions || [];
    if (targetSelector || hashPart) {
      existingPending.unshift({
        name: 'move_and_highlight',
        args: {
          selector: targetSelector || hashPart,
          explanation: explanation || `Arrived at ${targetSelector || hashPart}`
        }
      });
    }

    this._updateSessionStorage({
      connected: Boolean(this.client),
      endpoint: this.options.endpoint,
      lastRoute: resolvedUrl + hashPart,
      pendingActions: existingPending,
      timestamp: Date.now()
    });

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

  _readSessionStorage() {
    try {
      const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_) {
      return {};
    }
  }

  _updateSessionStorage(patch) {
    try {
      const prev = this._readSessionStorage();
      const next = Object.assign({}, prev, patch);
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(next));
    } catch (_) {}
  }

  _checkRestoredSession() {
    const runRestore = async () => {
      const state = this._readSessionStorage();
      const recent = state && Date.now() - (state.timestamp || 0) < 120000;

      // 1. Auto-reconnect Live Voice if it was active on the previous page
      if (recent && state.connected && state.endpoint && !this.client) {
        this.options.endpoint = state.endpoint;
        try {
          await this.start();
        } catch (err) {
          console.warn('[WebOrient] Auto-reconnect after page navigation skipped:', err);
        }
      }

      // 2. Resume active Multi-Page Salesperson Pitch if one was in progress across page load!
      if (this.memory.state.isPitchRunning && this.memory.state.activePitchQueue.length > 0) {
        await new Promise(r => setTimeout(r, 420));
        await this._runActivePitchLoop();
        return;
      }

      // 3. Execute any queued one-off cross-page actions
      if (recent && Array.isArray(state.pendingActions) && state.pendingActions.length > 0) {
        const actionsToRun = [...state.pendingActions];
        this._updateSessionStorage({ pendingActions: [] });

        await new Promise(r => setTimeout(r, 350));
        for (const act of actionsToRun) {
          if (act && act.name) {
            await this.handleToolCall(act.name, act.args || {});
            await new Promise(r => setTimeout(r, 250));
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
   * Optional self-contained floating launcher pill for zero-code 1-tag client installs
   */
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
      <button id="wo-launcher-pitch" style="
        background: linear-gradient(135deg, ${this.options.themeColor}, ${this.options.accentColor});
        color: #fff; border: none; padding: 10px 16px; border-radius: 999px;
        font-size: 12px; font-weight: 700; cursor: pointer;
        box-shadow: 0 8px 24px rgba(99, 102, 241, 0.4);
      ">▶ Start AI Salesperson Demo</button>
    `;
    document.body.appendChild(launcher);
    launcher.querySelector('#wo-launcher-pitch').addEventListener('click', () => {
      if (this.memory.state.isPitchRunning) {
        this.stopSalespersonDemo();
      } else {
        this.startSalespersonDemo();
      }
    });
  }

  _emit(eventType, detail) {
    if (typeof this.options.onEvent === 'function') {
      this.options.onEvent(eventType, detail);
    }
  }

  stop() {
    this.stopSalespersonDemo();
    this._updateSessionStorage({ connected: false, pendingActions: [] });
    if (this.client) this.client.stop();
    if (this.cursor) this.cursor.hideSpotlight();
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
