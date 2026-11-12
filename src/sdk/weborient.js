/**
 * WebOrient by DeployMate: Multi-Tenant Voice Co-Pilot & Shadow DOM SDK (`src/sdk/weborient.js` v1.0.0)
 * - 1-Line Embed Ready (`<script async src="..." data-site-key="wo_live_..." data-theme="signal" data-lang="en-IN">`)
 * - 3-Stage "VIP + Local Secretary" VAD Gate + 600ms Pre-Roll Ring Buffer + Auto-Wake from Hibernation
 * - Mandatory Two-Lock Form Submit Confirmation (`requireSubmitConfirmation: true` by default + On-Screen Confirm Pill)
 * - Progressive Lazy-Load Viewport Scroll Fallback when target selector is offscreen/unmounted
 * - Granular DOM Action Audit Log (`domEventLogs`) & Partial Lead Auto-Capture (`formFacts`) synced to Relay & MongoDB
 */
import { GhostCursor } from './ghost-cursor.js';
import { DOMScanner } from './dom-scanner.js';
import { LiveClient } from './live-client.js';
import { SessionMemory, SUPPORTED_LANGUAGES, isWebOrientDemoSite } from './session-memory.js';

const THEME_PRESETS = {
  signal: { primaryColor: '#E6391E', accentColor: '#0A0A0A' },
  deploymate: { primaryColor: '#E6391E', accentColor: '#0A0A0A' },
  indigo: { primaryColor: '#6366f1', accentColor: '#ec4899' }
};

export function getDefaultRelayEndpoint() {
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      return 'ws://localhost:8088';
    }
  }
  return 'wss://relay.deploymate.in';
}

export class WebOrient {
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
      requireSubmitConfirmation: true, // Enforced by default for production form safety!
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
    this.secretarySavedSeconds = 0;
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

    if (!this.client) {
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
          if (status === 'hibernating') {
            this._syncShadowWidgetState(true, 'hibernating');
          } else {
            this._syncShadowWidgetState(status === 'connected', 'idle');
          }
          this._emit('status', { status });
        },
        onVadStateChange: async (vadState, meta = {}) => {
          this.secretarySavedSeconds = meta.savedSeconds || this.secretarySavedSeconds;
          if (vadState === 'secretary_hold') {
            this._syncShadowWidgetState(true, 'secretary_hold');
          } else if (vadState === 'hibernating') {
            this._syncShadowWidgetState(true, 'hibernating');
          } else if (vadState === 'wake_from_hibernation') {
            if (this._isWaking) return;
            this._isWaking = true;
            this._syncShadowWidgetState(true, 'connecting');
            try {
              await this.start({ isRestore: true, flushAudioChunks: meta.bufferedChunks || [] });
            } catch (err) {
              console.warn('[WebOrient] Auto-wake from hibernation failed:', err);
              if (this.client) this.client.vadState = 'hibernating';
              this._syncShadowWidgetState(true, 'hibernating');
            } finally {
              this._isWaking = false;
            }
          } else {
            this._syncShadowWidgetState(true, 'listening');
          }
          this._emit('vadState', { vadState, ...meta });
        },
        onCreditUpdate: (creditInfo) => {
          this.remainingCredits = creditInfo.remainingMinutes;
          this.secretarySavedSeconds = creditInfo.secretarySavedSeconds ?? this.secretarySavedSeconds;
          this._emit('creditUpdate', creditInfo);
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
    } else {
      this.client.endpoint = wsUrl;
    }

    await this.client.connect({ flushAudioChunks: options.flushAudioChunks || [] });
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
      `[ALL INDEXED BUTTONS, INPUTS, IFRAMES, BANNERS & CLOSE ('X') CONTROLS ON PAGE (${initialElements.length} items)]:\n` +
      `${JSON.stringify(initialElements.map(e => ({ selector: e.selector, label: e.label, tag: e.tag, type: e.type, section: e.section, isCloseButton: e.isCloseButton || false, isIframeEmbed: e.isIframeEmbed || false })))}` +
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
      this.memory.recordDomEvent({
        tool: 'auto_ground_speech',
        selector: match.selector,
        label: match.title,
        explanation: badgeToDisplay,
        success: true
      });
      this._emit('autoGrounded', { selector: match.selector, title: match.title, explanation: badgeToDisplay });
    }
  }

  async orientTopic(todoOrQuery) {
    if (!todoOrQuery) return;
    if (this.client && this.client.vadState === 'hibernating') {
      await this.start({ isRestore: true });
    } else if (this.client) {
      this.client.markActivity('orient_topic');
    }

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

  _isSubmitButton(el) {
    if (!el || !(el instanceof Element)) return false;
    if (el.type === 'submit' || el.hasAttribute('data-confirm-required')) return true;
    const tag = el.tagName.toLowerCase();
    if (tag === 'button' || (tag === 'input' && el.type === 'button') || el.getAttribute('role') === 'button') {
      const txt = `${el.innerText || el.value || ''} ${el.getAttribute('aria-label') || ''}`.toLowerCase();
      if (/\b(submit|pay now|place order|confirm booking|complete order|send request|send message|confirm & submit)\b/i.test(txt)) {
        return true;
      }
    }
    return false;
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
          let targetEl = this.scanner.resolveElement(args.selector);
          // Progressive lazy-load viewport scroll fallback only when page still has room to scroll below
          if (!targetEl && typeof window !== 'undefined' && !options.skipAnimation) {
            const nearBottom = (window.scrollY + window.innerHeight) >= (document.documentElement.scrollHeight - 24);
            if (!nearBottom) {
              await this.cursor.scroll('down', null, 'half', 'Scanning page...');
              await this._waitForDOMSettle(100);
              targetEl = this.scanner.resolveElement(args.selector);
            }
          }

          if (!targetEl) {
            result = { success: false, elementFound: false, selector: args.selector, error: `Element not found: ${args.selector}` };
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
          const isSubmit = el && this._isSubmitButton(el);

          if (isSubmit && this.options.requireSubmitConfirmation && !args.confirmed) {
            await this.cursor.moveToElement(el, true, explanation || 'Confirm submit');
            this.cursor.showSubmitConfirmationPrompt(
              el,
              () => {
                this.memory.capturePartialFormFact('submitted', 'true', true);
                if (this.client) {
                  this.client.sendText('[USER CONFIRMED & SUBMITTED ON SCREEN]: The visitor clicked the on-screen Confirm & Submit button.', { turnComplete: false });
                }
                this.handleToolCall('click_element', { ...args, confirmed: true });
              },
              () => {
                if (this.client) {
                  this.client.sendText('[USER CANCELLED SUBMIT]: The user clicked Cancel on the submit confirmation prompt.', { turnComplete: false });
                }
              }
            );
            result = {
              success: true,
              requiresConfirmation: true,
              selector: args.selector,
              label: el ? this.scanner._getAccessibleLabel(el) : args.selector,
              message: 'Moved cursor to submit button and displayed on-screen [Confirm & Submit / Cancel] bar. Ask the user to verbally confirm or click Confirm on screen before calling click_element with confirmed=true.'
            };
          } else if (fastAck && el) {
            this.cursor.hideSubmitConfirmationPrompt();
            if (isSubmit) this.memory.capturePartialFormFact('submitted', 'true', true);
            this.memory.markOriented({ selector: args.selector, title: explanation || `Clicked ${args.selector}` });
            deferredVisualTask = true;
            this._enqueueVisualTask(() => this.cursor.click(el, explanation));
            result = {
              success: true,
              elementFound: true,
              action: 'click_element',
              selector: args.selector,
              label: this.scanner._getAccessibleLabel(el) || args.selector,
              audioSyncDirective: 'SPEAK_ALOUD_NOW: The Ghost Cursor is now clicking this element. Confirm the click aloud to the user right now!'
            };
          } else {
            this.cursor.hideSubmitConfirmationPrompt();
            if (isSubmit) this.memory.capturePartialFormFact('submitted', 'true', true);
            result = await this.cursor.click(args.selector, explanation);
            this.memory.markOriented({ selector: args.selector, title: explanation || `Clicked ${args.selector}` });
          }
          break;
        }

        case 'fill_form_field':
          result = await this.cursor.typeIntoField(args.selector, args.value ?? '', 22, explanation);
          this.memory.capturePartialFormFact(result.fieldName || args.selector, args.value ?? '');
          this.memory.markOriented({ selector: args.selector, title: explanation || `Filled ${args.selector}` });
          break;

        case 'fill_form_batch':
          result = await this.cursor.fillFormBatch(args.fields || [], explanation);
          for (const f of args.fields || []) {
            if (f && f.selector) this.memory.capturePartialFormFact(f.selector, f.value ?? '');
          }
          this.memory.markOriented({ selector: args.fields?.[0]?.selector || 'form', title: explanation || `Batch filled ${result.filledCount} fields` });
          break;

        case 'scroll_page':
          if (fastAck) {
            deferredVisualTask = true;
            this._enqueueVisualTask(() => this.cursor.scroll(args.direction || 'down', args.targetSelector || null, args.amount || 'page', explanation));
            result = {
              success: true,
              action: 'scroll_page',
              selector: args.targetSelector || `scroll:${args.direction || 'down'}`,
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

    // Record DOM telemetry event for Client & Super-Admin Dashboards
    const latestDomEvent = this.memory.recordDomEvent({
      tool: name,
      selector: args.selector || args.targetSelector || args.path || (args.fields?.[0]?.selector) || 'page',
      label: result.label || args.explanation || null,
      explanation: explanation || null,
      success: result.success !== false,
      error: result.error || null
    });

    if (!fastAck) {
      await this._waitForDOMSettle(120);
    }
    result.viewportSummary = this.scanner.captureStateSnapshot();

    const doneTodos = this.memory.state.todoChecklist.filter(t => t.done).map(t => t.id);
    const pendingTodos = this.memory.state.todoChecklist.filter(t => !t.done).map(t => ({ id: t.id, page: t.page, selector: t.selector, title: t.title }));
    const langCfg = this.memory.getLanguageConfig();
    const secretarySaved = this.client?.secretarySavedSeconds || this.secretarySavedSeconds || 0;
    const lastSection = this.memory.state.lastSectionViewed || result.viewportSummary?.activeSection || null;

    if (this.client && typeof this.client.sendTelemetry === 'function') {
      this.client.sendTelemetry({
        userLanguage: langCfg.code,
        userGoal: this.memory.state.userIntent.goal,
        interestedTier: this.memory.state.userIntent.interestedTier,
        lastSectionViewed: lastSection,
        secretarySavedSeconds: secretarySaved,
        domEventLogs: (this.memory.state.domEventLogs || []).slice(-25),
        partialLead: this.memory.state.formFacts || {}
      });
    }

    result.sessionMemoryDigest = {
      userLanguage: langCfg.code,
      userLanguageName: langCfg.name,
      languageNotes: this.memory.state.languageNotes || [],
      userGoal: this.memory.state.userIntent.goal,
      interestedTier: this.memory.state.userIntent.interestedTier,
      completedTodoIds: doneTodos,
      remainingTodos: pendingTodos.slice(0, 6),
      lastSectionViewed: lastSection,
      latestDomEvent
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
    if (/^(javascript|data|vbscript):/i.test(path)) {
      return { success: false, error: 'Blocked unsafe URI scheme in navigate_route' };
    }

    if (path.startsWith('#')) {
      const hashEl = document.querySelector(path);
      if (hashEl) {
        window.history.pushState({}, '', path);
        const res = await this.cursor.moveToElement(hashEl, true, explanation || path);
        this.memory.markOriented({ selector: path, title: explanation || path });
        return res;
      }
    }

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
        .wo-dot.wo-hold {
          background: #fbbf24;
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
        } else if (this.client.vadState === 'hibernating') {
          this._syncShadowWidgetState(true, 'connecting');
          try {
            await this.start({ isRestore: true });
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
      if (state === 'speaking') {
        mic.style.display = 'none';
        wave.style.display = 'flex';
        sub.textContent = 'AI Co-Browsing...';
        if (dot) dot.className = 'wo-dot wo-speaking';
      } else if (state === 'secretary_hold') {
        mic.style.display = 'flex';
        wave.style.display = 'none';
        sub.textContent = 'Standby (0m burn · Speak)';
        if (dot) dot.className = 'wo-dot wo-hold';
      } else if (state === 'hibernating') {
        mic.style.display = 'flex';
        wave.style.display = 'none';
        sub.textContent = 'Paused · Speak to wake';
        if (dot) dot.className = 'wo-dot wo-hold';
      } else if (state === 'connecting') {
        mic.style.display = 'none';
        wave.style.display = 'flex';
        sub.textContent = 'Connecting...';
        if (dot) dot.className = 'wo-dot';
      } else {
        mic.style.display = 'none';
        wave.style.display = 'flex';
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
      this.cursor.hideSubmitConfirmationPrompt();
    }
    this._syncShadowWidgetState(false, 'idle');
  }
}

export { SUPPORTED_LANGUAGES };

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
        requireSubmitConfirmation: scriptEl.dataset.confirmSubmit !== 'false',
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
