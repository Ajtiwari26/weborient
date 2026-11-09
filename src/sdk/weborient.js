/**
 * WebOrient: Autonomous Voice Co-Browsing SDK
 * Main entry point.
 */
import { GhostCursor } from './ghost-cursor.js';
import { DOMScanner } from './dom-scanner.js';
import { LiveClient } from './live-client.js';

export class WebOrient {
  constructor(options = {}) {
    this.options = Object.assign({
      endpoint: null,
      themeColor: '#6366f1',
      accentColor: '#ec4899',
      cursorStyle: 'modern-glow',
      manifestUrl: null
    }, options);

    this.cursor = new GhostCursor({
      primaryColor: this.options.themeColor,
      accentColor: this.options.accentColor,
      cursorStyle: this.options.cursorStyle
    });

    this.scanner = new DOMScanner();
    this.client = null;
    this.manifest = null;

    if (this.options.manifestUrl) {
      this.loadManifest(this.options.manifestUrl);
    }
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
      console.warn('[WebOrient] No WebSocket endpoint provided. Running in simulation/local test mode.');
      return;
    }

    this.client = new LiveClient({
      endpoint: this.options.endpoint,
      onToolCall: (name, args, callId) => this.handleToolCall(name, args, callId),
      onStatusChange: (status) => console.log(`[WebOrient] Status: ${status}`)
    });

    await this.client.connect();
  }

  /**
   * Routes model tool calls directly to browser DOM actions
   */
  async handleToolCall(name, args, callId) {
    console.log(`[WebOrient] Executing Tool Call: ${name}`, args);
    let result = { success: true };

    switch (name) {
      case 'move_and_highlight':
        result = await this.cursor.moveToElement(args.selector, true);
        break;

      case 'click_element':
        result = await this.cursor.click(args.selector);
        break;

      case 'fill_form_field':
        result = await this.cursor.typeIntoField(args.selector, args.value);
        break;

      case 'scroll_page':
        result = await this.cursor.scroll(args.direction, args.targetSelector);
        break;

      case 'navigate_route':
        if (args.path) {
          window.location.href = args.path;
        }
        break;

      case 'scan_visible_elements':
        result = { elements: this.scanner.scan() };
        break;

      default:
        console.warn(`[WebOrient] Unknown tool: ${name}`);
        result = { success: false, error: 'Unknown tool' };
    }

    if (this.client && callId) {
      this.client.sendToolResponse(callId, result);
    }

    return result;
  }

  stop() {
    if (this.client) this.client.stop();
    if (this.cursor) this.cursor.destroy();
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
