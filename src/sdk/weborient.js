/**
 * WebOrient by DeployMate: Multi-Tenant Voice Co-Pilot & Shadow DOM SDK (`src/sdk/weborient.js` v0.6.0)
 * - 1-Line Embed Ready (`<script async src="..." data-site-key="wo_live_..." data-theme="signal" data-lang="en-IN">`)
 * - Full-Page, Popup, Modal, Drawer, Banner & Close-Button (`X`) Auto-Indexing via Live `MutationObserver`
 * - Strict Showing-vs-Saying Language Synchronization:
 *   Detects & locks user language (`en-IN`, `hinglish`, `hi-IN`, `es-ES`, `fr-FR`), records persistent
 *   agent notes, updates the Shadow DOM language badge, and synchronizes the floating Ghost Cursor
 *   coachmark badge (`explanation`) with the exact language and phrasing the agent is speaking!
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
   * expandable dossiers, and SPA route transitions (`pushState` / `popstate`) so
   * newly rendered buttons and Close ('X') buttons are indexed automatically!
   */
  _startLiveDomObserver() {
    if (typeof window === 'undefined' || typeof MutationObserver === 'undefined') return;

    let debounceTimer = null;
    const checkDomDelta = () => {
      this.memory.syncDynamicDomChecklist(this.scanner, this.manifest);
      const currentRoute = window.location.pathname + window.location.hash;
      const activePopups = this.scanner.scanActiveOverlaysAndPopups();
      const popupSig = activePopups.map(p => `${p.selector}:${p.closeButtonSelector || ''}`).join('|');

      const routeChanged = this._lastObservedRoute && this._lastObservedRoute !== currentRoute;
      const popupChanged = popupSig !== this._lastPopupSignature;

      this._lastObservedRoute = currentRoute;
      this._lastPopupSignature = popupSig;

      if (this.client && (popupChanged || routeChanged)) {
        const langCfg = this.memory.getLanguageConfig();
        const visibleControls = this.scanner.scan({ includeOffscreen: false }).slice(0, 60);
        const updateMsg = [
          `[LIVE DOM & POPUP INDEX UPDATE — Route: ${currentRoute} | Active Language Lock: ${langCfg.name}]`,
          activePopups.length > 0
            ? `ACTIVE POPUPS / MODALS / DRAWERS ON SCREEN (Including Close 'X' Buttons): ${JSON.stringify(activePopups)}`
            : `No modal/popup currently open.`,
          `Visible Interactive Controls & Buttons: ${JSON.stringify(visibleControls.map(e => ({ selector: e.selector, label: e.label, tag: e.tag, type: e.type, isCloseButton: e.isCloseButton || false })))}`
        ].join('\n');
        this.client.sendText(updateMsg);
      }
    };

    const scheduleCheck = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(checkDomDelta, 380);
    };

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
        if (relevant) scheduleCheck();
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

    window.addEventListener('popstate', scheduleCheck);
    window.addEventListener('hashchange', scheduleCheck);
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

    if (this.client && prevLang !== langCfg.code) {
      this.client.sendText(
        `[CRITICAL LANGUAGE LOCK & SHOWING-SAYING SYNC]: Detected & locked user language to ${langCfg.name} (${langCfg.code}). ` +
        `Note recorded in session memory. You MUST continue speaking strictly in ${langCfg.name} AND write every single \`explanation\` badge in \`move_and_highlight\`, \`click_element\`, \`fill_form_field\`, and \`swipe_or_swap\` in ${langCfg.name} so what is SHOWN on screen and what is SAID aloud are 100% in sync!`
      );
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

  /**
   * Connects microphone audio to the DeployMate Multi-Tenant Relay & Gemini Live Model
   */
  async start() {
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
      onToolCall: (name, args, callId) => this.handleToolCall(name, args, callId),
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

    this.client.sendText(
      `[SESSION CONTINUITY & FULL DOM INDEX HANDOFF]\n${memorySummary}\n` +
      (liveMetadata ? `[CLIENT WEBSITE METADATA & FAQ]:\n${liveMetadata}\n` : '') +
      `[DISCOVERED SITE PAGES, ANCHORS & SPA NAVIGATION TRIGGERS]:\n${JSON.stringify(discoveredRoutes)}\n` +
      (activePopups.length > 0 ? `[ACTIVE POPUPS / MODALS / DRAWERS ON SCREEN]:\n${JSON.stringify(activePopups)}\n` : '') +
      `[CURRENT PAGE SECTIONS ("${document.title}" - ${initialSnapshot.url})]:\n` +
      `${JSON.stringify((pageContent.matchingSections || []).map(s => ({ selector: s.selector, heading: s.heading, summary: (s.summary || '').slice(0, 180) })))}\n` +
      `[ALL INDEXED BUTTONS, INPUTS, BANNERS & CLOSE ('X') CONTROLS ON PAGE (${initialElements.length} items)]:\n` +
      `${JSON.stringify(initialElements.map(e => ({ selector: e.selector, label: e.label, tag: e.tag, type: e.type, section: e.section, isCloseButton: e.isCloseButton || false })))}`
    );
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

  async handleToolCall(name, args = {}, callId = null) {
    console.log(`[WebOrient] Executing Tool Call: ${name}`, args);
    this._lastExplicitToolTime = Date.now();
    this._isExecutingTool = true;
    this._emit('toolCall', { name, args, callId });

    let result = { success: true, action: name };
    const spokenFallback = this._getCleanSpokenCaption(this._modelSpeechBuffer) || null;
    const explanation = args.explanation || args.spokenText || spokenFallback;

    try {
      switch (name) {
        case 'show_and_describe':
        case 'move_and_highlight': {
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
            await this.cursor.moveToElement(el, true, explanation || 'Confirm submit');
            result = {
              success: true,
              requiresConfirmation: true,
              selector: args.selector,
              message: 'Moved cursor to submit button. Ask user to confirm before calling click_element with confirmed=true.'
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
          result = await this.cursor.scroll(
            args.direction || 'down',
            args.targetSelector || null,
            args.amount || 'page',
            explanation
          );
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
            await this.cursor.moveToElement(
              secToHighlight,
              true,
              explanation || result.matchingSections?.[0]?.heading || args.query
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
    } finally {
      this._isExecutingTool = false;
      this._lastExplicitToolTime = Date.now();
    }

    await this._waitForDOMSettle(160);
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
          await this.start();
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

export { SUPPORTED_LANGUAGES };

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
