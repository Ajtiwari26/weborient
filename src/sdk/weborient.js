/**
 * WebOrient: Autonomous Voice Co-Browsing, Session-Aware Memory & Synchronized Salesperson SDK (v0.3.0)
 * - Persistent Cross-Page Session Memory (`SessionMemory`: what has been oriented, what remains to describe,
 *   what the user wants, user's native language, and remembered form profile)
 * - Synchronized "Show & Describe Simultaneously" Salesperson Engine (`SpeechSyncEngine` + `GhostCursor`)
 * - Complete 12-Tool Router with Closed-Loop Act -> Settle -> Diff -> Respond verification
 */
import { GhostCursor } from './ghost-cursor.js';
import { DOMScanner } from './dom-scanner.js';
import { LiveClient } from './live-client.js';
import { SessionMemory, SUPPORTED_LANGUAGES } from './session-memory.js';
import { SpeechSyncEngine, SALESPERSON_SCRIPTS } from './speech-sync.js';

const SESSION_STORAGE_KEY = 'weborient_session_state_v2';

export class WebOrient {
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

export { SUPPORTED_LANGUAGES, SALESPERSON_SCRIPTS };

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
