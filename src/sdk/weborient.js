/**
 * WebOrient by DeployMate: Multi-Tenant Voice Co-Pilot & Shadow DOM SDK (`src/sdk/weborient.js` v0.5.0)
 * - 1-Line Embed Ready (`<script async src="..." data-site-key="wo_live_..." data-theme="signal" data-lang="en-IN">`)
 * - Shadow DOM Encapsulation: Mounts both the Ghost Cursor overlay and the Siri-like Assist Pill
 *   inside `#weborient-shadow-host` (`ShadowRoot`) so client CSS never collides with WebOrient
 * - Multi-Tenant Gateway Handshake: Passes `siteKey`, `siteId`, `sessionId`, `lang`, and `origin`
 * - Non-Linear To-Do Checklist Memory (`SessionMemory`) & Refresh-Safe Continuity
 */
import { GhostCursor } from './ghost-cursor.js';
import { DOMScanner } from './dom-scanner.js';
import { LiveClient } from './live-client.js';
import { SessionMemory, SUPPORTED_LANGUAGES } from './session-memory.js';

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
      endpoint: this.options.endpoint,
      defaultLanguage: this.options.defaultLanguage,
      onChange: (memState) => {
        queueMicrotask(() => this._emit('memoryUpdate', memState));
      }
    });

    if (this.options.defaultLanguage && !this.memory.state.languageLocked) {
      this.memory.setLanguage(this.options.defaultLanguage, false);
    }

    this.client = null;
    this.manifest = null;
    this.remainingCredits = null;
    this._modelSpeechBuffer = '';
    this._lastAutoGroundedSelector = null;
    this._lastExplicitToolTime = 0;
    this._isExecutingTool = false;

    if (typeof window !== 'undefined') {
      const currentFile = window.location.pathname.split('/').pop() || 'test-demo.html';
      this.memory.recordPageVisit(currentFile);
    }

    this._manifestReadyPromise = this.options.manifestUrl
      ? this.loadManifest(this.options.manifestUrl)
      : Promise.resolve(null);

    if (this.options.autoMountLauncher && typeof document !== 'undefined') {
      this._mountShadowAssistWidget();
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

    const initialSnapshot = this.scanner.captureStateSnapshot();
    const initialElements = this.scanner.scan({ includeOffscreen: true }).slice(0, 35);
    const memorySummary = this.memory.buildModelContextSummary();

    this.client.sendText(
      `[SESSION CONTINUITY HANDOFF]\n${memorySummary}\n` +
      `[CURRENT PAGE DOM ("${document.title}" - ${initialSnapshot.url})]:\n` +
      `Interactive & Section Elements on Screen: ${JSON.stringify(initialElements.map(e => ({ selector: e.selector, label: e.label, tag: e.tag, type: e.type })))}`
    );
  }

  _autoGroundFromModelSpeech(chunk) {
    this._modelSpeechBuffer = `${this._modelSpeechBuffer} ${chunk}`.slice(-260);

    if (this._isExecutingTool || Date.now() - this._lastExplicitToolTime < 2200) return;

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

  async orientTopic(todoOrQuery) {
    if (!todoOrQuery) return;
    const currentFile = window.location.pathname.split('/').pop() || 'test-demo.html';

    if (typeof todoOrQuery === 'object' && todoOrQuery.selector) {
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

  async handleToolCall(name, args = {}, callId = null) {
    console.log(`[WebOrient] Executing Tool Call: ${name}`, args);
    this._lastExplicitToolTime = Date.now();
    this._isExecutingTool = true;
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
    } finally {
      this._isExecutingTool = false;
      this._lastExplicitToolTime = Date.now();
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

    const navLink = document.querySelector(`#global-site-header a[href*="${targetFile}"], a[href*="${targetFile}"]`);
    if (navLink) {
      await this.cursor.moveToElement(navLink, true, `Navigating to ${matchedPage?.title || targetFile}...`);
      await this.cursor.playClickAnimation();
      await new Promise(r => setTimeout(r, 120));
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
   * Mounts the self-contained Siri-like Assist Pill + 5-Bar Soundwave inside the
   * isolated Shadow DOM (`#weborient-shadow-host`) so 1-line `<script>` embeds
   * work on any external website with zero CSS leakage or collision.
   */
  _mountShadowAssistWidget() {
    const shadowRoot = this.cursor?.getOrCreateShadowRoot();
    if (!shadowRoot || shadowRoot.getElementById('wo-shadow-assist')) return;

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
        .wo-pill-btn {
          display: flex;
          align-items: center;
          gap: 11px;
          padding: 10px 18px;
          border-radius: 999px;
          background: #0A0A0A;
          color: #FFFFFF;
          border: 2px solid ${this.options.themeColor};
          box-shadow: 0 14px 34px rgba(10, 10, 10, 0.35);
          cursor: pointer;
          transition: transform 0.2s cubic-bezier(0.215, 0.61, 0.355, 1), background 0.2s ease;
        }
        .wo-pill-btn:hover {
          transform: translateY(-2px);
        }
        .wo-pill-btn:active {
          transform: scale(0.96);
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
          width: 3.5px;
          height: 20px;
          border-radius: 999px;
          background: ${this.options.themeColor};
          animation: wo-siri-wave 1s ease-in-out infinite;
        }
        .wo-bar:nth-child(2) { animation-delay: 0.15s; height: 24px; background: #FFFFFF; }
        .wo-bar:nth-child(3) { animation-delay: 0.3s; height: 28px; background: ${this.options.themeColor}; }
        .wo-bar:nth-child(4) { animation-delay: 0.45s; height: 22px; background: #FFFFFF; }
        .wo-bar:nth-child(5) { animation-delay: 0.6s; height: 16px; background: ${this.options.themeColor}; }
        .wo-meta {
          display: flex;
          flex-direction: column;
          text-align: left;
        }
        .wo-title {
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.03em;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .wo-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: ${this.options.themeColor};
        }
        .wo-sub {
          font-family: 'Fira Code', monospace;
          font-size: 9px;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          color: rgba(255, 255, 255, 0.65);
        }
      </style>
      <div id="wo-assist-root">
        <button type="button" class="wo-pill-btn" id="wo-shadow-btn" aria-label="Toggle WebOrient Voice Co-Pilot">
          <div class="wo-mic-circle" id="wo-shadow-mic">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
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
              <span>Assist</span>
              <span class="wo-dot" id="wo-shadow-dot"></span>
            </span>
            <span class="wo-sub" id="wo-shadow-sub">Click to talk</span>
          </div>
        </button>
      </div>
    `;

    shadowRoot.appendChild(wrapper);
    const btn = shadowRoot.getElementById('wo-shadow-btn');
    if (btn) {
      btn.addEventListener('click', async () => {
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
    const mic = shadowRoot.getElementById('wo-shadow-mic');
    const wave = shadowRoot.getElementById('wo-shadow-wave');
    const sub = shadowRoot.getElementById('wo-shadow-sub');
    if (!mic || !wave || !sub) return;

    if (connected) {
      mic.style.display = 'none';
      wave.style.display = 'flex';
      sub.textContent = state === 'speaking' ? 'Speaking...' : (state === 'connecting' ? 'Connecting...' : 'Listening...');
    } else {
      mic.style.display = 'flex';
      wave.style.display = 'none';
      sub.textContent = state === 'offline' ? 'Relay offline' : 'Click to talk';
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
