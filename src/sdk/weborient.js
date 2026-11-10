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
import { GhostCursor } from './ghost-cursor.js';
import { DOMScanner } from './dom-scanner.js';
import { LiveClient } from './live-client.js';
import { SessionMemory, SUPPORTED_LANGUAGES } from './session-memory.js';

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

export { SUPPORTED_LANGUAGES };

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
