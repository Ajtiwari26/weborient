/**
 * WebOrient: Autonomous Voice Co-Browsing & Ghost Cursor SDK (v0.2.0)
 * - Closed-loop Act -> Settle -> Diff -> Respond tool orchestration
 * - Complete 10-tool router: Q&A content extraction, visual explanation, multi-step tour,
 *   form filling, batch form filling, smart scrolling, carousel/tab/switch swiping & swapping,
 *   navigation, scanning, and clicking
 * - Cross-page session persistence via sessionStorage + SPA route resolution
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

    if (this.options.manifestUrl) {
      this.loadManifest(this.options.manifestUrl);
    }

    this._checkRestoredSession();
  }

  async loadManifest(url) {
    try {
      const res = await fetch(url);
      this.manifest = await res.json();
      console.log('[WebOrient] Loaded site manifest:', this.manifest.siteName);
    } catch (e) {
      console.warn('[WebOrient] Failed to load manifest:', e);
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
    this._saveSessionState({ connected: true, endpoint: this.options.endpoint });

    // Send initial viewport & page summary so Gemini immediately knows what's on screen
    const initialSnapshot = this.scanner.captureStateSnapshot();
    const initialElements = this.scanner.scan({ includeOffscreen: false }).slice(0, 25);
    this.client.sendText(
      `[SYSTEM CONTEXT: User is currently on ${initialSnapshot.url}. Active section: ${initialSnapshot.activeSection || 'top'}. Visible interactive elements: ${JSON.stringify(initialElements.map(e => ({ selector: e.selector, label: e.label, tag: e.tag, type: e.type })))}]`
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
          result = await this._handleNavigation(args.path);
          break;

        case 'scan_visible_elements':
          result = {
            success: true,
            action: 'scan_visible_elements',
            elements: this.scanner.scan({ includeOffscreen: Boolean(args.includeOffscreen) })
          };
          break;

        case 'read_page_content':
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
   * Resolves in-page anchors, manifest routes, SPA History transitions, or cross-page navigation
   */
  async _handleNavigation(rawPath) {
    if (!rawPath) {
      return { success: false, error: 'Missing navigation path' };
    }

    const path = String(rawPath).trim();

    // 1. Check if manifest maps this route (e.g. "/pricing") to an in-page hash ("#pricing-section")
    if (this.manifest && Array.isArray(this.manifest.pages)) {
      const matchedPage = this.manifest.pages.find(
        p => p.route === path ||
             p.title?.toLowerCase() === path.toLowerCase() ||
             (p.keywords || []).includes(path.toLowerCase())
      );
      if (matchedPage && matchedPage.hash) {
        const hashTarget = document.querySelector(matchedPage.hash);
        if (hashTarget) {
          window.history.pushState({}, '', matchedPage.hash);
          return await this.cursor.moveToElement(
            matchedPage.hash,
            true,
            `Navigated to ${matchedPage.title}`
          );
        }
      }
    }

    // 2. Check if path is an in-page hash or matching section ID (e.g. "#pricing" or "/pricing" -> "#pricing-section")
    const slug = path.replace(/^[#/]+/, '').toLowerCase();
    const inPageTarget =
      (path.startsWith('#') && document.querySelector(path)) ||
      document.getElementById(slug) ||
      document.getElementById(`${slug}-section`);

    if (inPageTarget) {
      window.history.pushState({}, '', `#${inPageTarget.id}`);
      return await this.cursor.moveToElement(
        inPageTarget,
        true,
        `Navigated to ${inPageTarget.id}`
      );
    }

    // 3. Full-page navigation: persist session state to sessionStorage before navigating
    this._saveSessionState({
      connected: Boolean(this.client),
      endpoint: this.options.endpoint,
      lastRoute: path,
      timestamp: Date.now()
    });

    window.location.href = path;
    return {
      success: true,
      action: 'navigate_route',
      navigatedTo: path
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

  _saveSessionState(state) {
    try {
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(state));
    } catch (_) {}
  }

  _checkRestoredSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) return;
      const state = JSON.parse(raw);
      // Auto-reconnect if navigated within the last 30 seconds
      if (state.connected && state.endpoint && Date.now() - (state.timestamp || 0) < 30000) {
        this.options.endpoint = state.endpoint;
        window.addEventListener('DOMContentLoaded', () => {
          this.start().catch(err => console.warn('[WebOrient] Session auto-resume skipped:', err));
        }, { once: true });
      }
    } catch (_) {}
  }

  _emit(eventType, detail) {
    if (typeof this.options.onEvent === 'function') {
      this.options.onEvent(eventType, detail);
    }
  }

  stop() {
    this._saveSessionState({ connected: false });
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
