/**
 * WebOrient: Autonomous Voice Co-Browsing & Ghost Cursor SDK (v0.2.0)
 * - Closed-loop Act -> Settle -> Diff -> Respond tool orchestration
 * - Complete 10-tool router: Q&A content extraction, visual explanation, multi-step tour,
 *   form filling, batch form filling, smart scrolling, carousel/tab/switch swiping & swapping,
 *   multi-page navigation, scanning, and clicking
 * - Cross-page session persistence + post-navigation pending action queue via sessionStorage
 * - Safety confirmation gate for final form submissions and sensitive buttons
 */
import { GhostCursor } from './ghost-cursor.js';
import { DOMScanner } from './dom-scanner.js';
import { LiveClient } from './live-client.js';

const SESSION_STORAGE_KEY = 'weborient_session_state_v2';

export class WebOrient {
  constructor(options = {}) {
    this.options = Object.assign({
      endpoint: null,
      themeColor: '#6366f1',
      accentColor: '#ec4899',
      cursorStyle: 'modern-glow',
      manifestUrl: null,
      requireSubmitConfirmation: false,
      onEvent: null
    }, options);

    this.scanner = new DOMScanner();
    this.cursor = new GhostCursor({
      primaryColor: this.options.themeColor,
      accentColor: this.options.accentColor,
      cursorStyle: this.options.cursorStyle,
      scanner: this.scanner
    });

    this.client = null;
    this.manifest = null;
    this._manifestReadyPromise = this.options.manifestUrl
      ? this.loadManifest(this.options.manifestUrl)
      : Promise.resolve(null);

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
   * Connects microphone audio and starts the live co-browsing session
   */
  async start() {
    if (!this.options.endpoint) {
      console.warn('[WebOrient] No WebSocket endpoint provided. Running in local interactive mode.');
      return;
    }

    this.client = new LiveClient({
      endpoint: this.options.endpoint,
      onToolCall: (name, args, callId) => this.handleToolCall(name, args, callId),
      onStatusChange: (status) => {
        console.log(`[WebOrient] Status: ${status}`);
        this._emit('status', { status });
      },
      onTranscript: (text, role) => {
        this._emit('transcript', { text, role });
      },
      onInterrupted: () => {
        this.cursor.cancelActiveActions();
        this._emit('interrupted', {});
      }
    });

    await this.client.connect();
    this._updateSessionStorage({ connected: true, endpoint: this.options.endpoint, timestamp: Date.now() });

    // Send current page context so Gemini immediately knows what page & elements are active
    const initialSnapshot = this.scanner.captureStateSnapshot();
    const initialElements = this.scanner.scan({ includeOffscreen: false }).slice(0, 30);
    this.client.sendText(
      `[SYSTEM CONTEXT: User is currently on page "${document.title}" (${initialSnapshot.url}). Active section: ${initialSnapshot.activeSection || 'top'}. Visible interactive elements: ${JSON.stringify(initialElements.map(e => ({ selector: e.selector, label: e.label, tag: e.tag, type: e.type })))}]`
    );
  }

  /**
   * Sends a natural language text prompt or question to the connected Live session
   */
  sendTextPrompt(text) {
    if (this.client) {
      this.client.sendText(text);
      return true;
    }
    return false;
  }

  /**
   * Queues a list of tool calls to run automatically as soon as the next page finishes loading
   */
  queuePostNavigationActions(actions = []) {
    this._updateSessionStorage({
      pendingActions: actions,
      timestamp: Date.now()
    });
  }

  /**
   * Routes model tool calls to DOM actuators with closed-loop settle & verification
   */
  async handleToolCall(name, args = {}, callId = null) {
    console.log(`[WebOrient] Executing Tool Call: ${name}`, args);
    this._emit('toolCall', { name, args, callId });

    let result = { success: true, action: name };

    try {
      switch (name) {
        case 'move_and_highlight':
          result = await this.cursor.moveToElement(
            args.selector,
            true,
            args.explanation || null
          );
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
          }
          break;
        }

        case 'fill_form_field':
          result = await this.cursor.typeIntoField(args.selector, args.value ?? '');
          break;

        case 'fill_form_batch':
          result = await this.cursor.fillFormBatch(args.fields || []);
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
          }
          break;

        case 'guide_tour':
          result = await this.cursor.guideTour(args.steps || []);
          break;

        default:
          console.warn(`[WebOrient] Unknown tool: ${name}`);
          result = { success: false, error: `Unknown tool: ${name}` };
      }
    } catch (err) {
      console.error(`[WebOrient] Tool error in ${name}:`, err);
      result = { success: false, action: name, error: err.message };
    }

    // Wait briefly for DOM mutations/transitions to settle, then attach closed-loop snapshot
    await this._waitForDOMSettle(120);
    result.viewportSummary = this.scanner.captureStateSnapshot();

    if (this.client && callId) {
      this.client.sendToolResponse(callId, name, result);
    }

    this._emit('toolResult', { name, args, callId, result });
    return result;
  }

  /**
   * Resolves multi-page routes, manifest page mappings, or in-page section anchors
   */
  async _handleNavigation(rawPath, targetSelector = null, explanation = null) {
    if (!rawPath) {
      return { success: false, error: 'Missing navigation path' };
    }

    await this._manifestReadyPromise;
    const path = String(rawPath).trim();

    // 1. If path is an explicit in-page hash (#section) and exists on the current page, scroll to it
    if (path.startsWith('#')) {
      const hashEl = document.querySelector(path);
      if (hashEl) {
        window.history.pushState({}, '', path);
        return await this.cursor.moveToElement(hashEl, true, explanation || `Navigated to ${path}`);
      }
    }

    // 2. Match against manifest pages (supports multi-page .html files as well as clean routes)
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

    // 3. Fallback multi-page route resolution for common page names
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

    // Preserve any hash fragment attached to the path
    const hashPart = path.includes('#') ? `#${path.split('#')[1]}` : '';
    const currentFile = window.location.pathname.split('/').pop() || 'test-demo.html';
    const targetFile = resolvedUrl.split('#')[0].split('/').pop();

    // If we are already on the target page file, simply move to the target section or top
    if (targetFile === currentFile) {
      const selectorToFocus = targetSelector || hashPart || 'h1';
      return await this.cursor.moveToElement(
        selectorToFocus,
        true,
        explanation || `Already on ${matchedPage?.title || targetFile}`
      );
    }

    // Animate cursor to matching header nav link before transitioning pages for visual continuity
    const navLink = document.querySelector(`a[href*="${targetFile}"]`);
    if (navLink) {
      await this.cursor.moveToElement(navLink, true, `Navigating to ${matchedPage?.title || targetFile}...`);
      await new Promise(r => setTimeout(r, 260));
    }

    // Save post-navigation action if targetSelector or hash was requested
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

    // Resolve relative URL cleanly within testscript/ or current folder
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
      if (!state || Date.now() - (state.timestamp || 0) > 60000) return;

      // 1. Auto-reconnect Live Voice if it was active on the previous page
      if (state.connected && state.endpoint && !this.client) {
        this.options.endpoint = state.endpoint;
        try {
          await this.start();
        } catch (err) {
          console.warn('[WebOrient] Auto-reconnect after page navigation skipped:', err);
        }
      }

      // 2. Execute any queued cross-page actions (e.g., highlight, toggle, fill form after landing)
      if (Array.isArray(state.pendingActions) && state.pendingActions.length > 0) {
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

  _emit(eventType, detail) {
    if (typeof this.options.onEvent === 'function') {
      this.options.onEvent(eventType, detail);
    }
  }

  stop() {
    this._updateSessionStorage({ connected: false, pendingActions: [] });
    if (this.client) this.client.stop();
    if (this.cursor) this.cursor.hideSpotlight();
  }
}

// Auto-initialize when loaded via script tag with data-attributes
if (typeof window !== 'undefined') {
  window.WebOrient = WebOrient;

  const currentScript = document.currentScript;
  if (currentScript && currentScript.dataset.endpoint) {
    window.weborientInstance = new WebOrient({
      endpoint: currentScript.dataset.endpoint,
      themeColor: currentScript.dataset.themeColor || '#6366f1',
      accentColor: currentScript.dataset.accentColor || '#ec4899',
      manifestUrl: currentScript.dataset.manifest || null
    });
  }
}
