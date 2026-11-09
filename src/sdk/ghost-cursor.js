/**
 * WebOrient Ghost Cursor Engine
 * Renders an animated on-screen pointer, element spotlight, click ripples,
 * and typewriter form input animations.
 */
export class GhostCursor {
  constructor(options = {}) {
    this.primaryColor = options.primaryColor || '#6366f1';
    this.accentColor = options.accentColor || '#ec4899';
    this.cursorStyle = options.cursorStyle || 'modern-glow';
    this.currentPosition = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    this.isMoving = false;

    this._initOverlay();
  }

  _initOverlay() {
    if (document.getElementById('weborient-overlay')) return;

    // Fixed non-blocking container
    this.container = document.createElement('div');
    this.container.id = 'weborient-overlay';
    this.container.style.cssText = `
      position: fixed;
      top: 0; left: 0;
      width: 100vw; height: 100vh;
      pointer-events: none;
      z-index: 2147483647;
      overflow: hidden;
    `;

    // Spotlight Element Box
    this.spotlight = document.createElement('div');
    this.spotlight.id = 'weborient-spotlight';
    this.spotlight.style.cssText = `
      position: fixed;
      border: 2px solid ${this.primaryColor};
      border-radius: 8px;
      box-shadow: 0 0 20px ${this.primaryColor}88, inset 0 0 10px ${this.primaryColor}33;
      pointer-events: none;
      opacity: 0;
      transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
      z-index: 2147483646;
    `;

    // Ghost Cursor Pointer
    this.cursor = document.createElement('div');
    this.cursor.id = 'weborient-cursor';
    this.cursor.innerHTML = `
      <div class="weborient-pointer" style="position: relative; width: 28px; height: 28px;">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" style="filter: drop-shadow(0 2px 8px rgba(0,0,0,0.35));">
          <path d="M4 3L11 20L14.5 13.5L21 11L4 3Z" fill="${this.primaryColor}" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/>
        </svg>
        <div class="weborient-ring" style="
          position: absolute; top: -6px; left: -6px; width: 34px; height: 34px;
          border: 2px solid ${this.accentColor}; border-radius: 50%;
          opacity: 0; transform: scale(0.6);
          transition: transform 0.35s ease-out, opacity 0.35s ease-out;
        "></div>
      </div>
    `;
    this.cursor.style.cssText = `
      position: fixed;
      top: 0; left: 0;
      transform: translate3d(${this.currentPosition.x}px, ${this.currentPosition.y}px, 0);
      transition: transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
      will-change: transform;
      pointer-events: none;
      z-index: 2147483647;
    `;

    this.container.appendChild(this.spotlight);
    this.container.appendChild(this.cursor);
    document.body.appendChild(this.container);

    // Update position on window resize
    window.addEventListener('resize', () => {
      this.hideSpotlight();
    });
  }

  /**
   * Moves cursor to viewport coordinates (x, y)
   */
  async moveTo(x, y, durationMs = 600) {
    this.cursor.style.transition = `transform ${durationMs}ms cubic-bezier(0.22, 1, 0.36, 1)`;
    this.cursor.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    this.currentPosition = { x, y };
    await new Promise(r => setTimeout(r, durationMs));
  }

  /**
   * Highlights a target element and moves the cursor to it
   */
  async moveToElement(selector, highlight = true) {
    const el = document.querySelector(selector);
    if (!el) {
      console.warn(`[WebOrient] Element not found: ${selector}`);
      return { success: false, error: 'Element not found' };
    }

    // Smooth scroll into viewport center if out of view
    el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    await new Promise(r => setTimeout(r, 350));

    const rect = el.getBoundingClientRect();
    const targetX = rect.left + rect.width / 2;
    const targetY = rect.top + rect.height / 2;

    await this.moveTo(targetX, targetY);

    if (highlight) {
      this.spotlight.style.top = `${rect.top - 4}px`;
      this.spotlight.style.left = `${rect.left - 4}px`;
      this.spotlight.style.width = `${rect.width + 8}px`;
      this.spotlight.style.height = `${rect.height + 8}px`;
      this.spotlight.style.opacity = '1';
    }

    return { success: true };
  }

  /**
   * Performs an animated click ripple and dispatches native click event
   */
  async click(selector) {
    const res = await this.moveToElement(selector);
    if (!res.success) return res;

    const ring = this.cursor.querySelector('.weborient-ring');
    if (ring) {
      ring.style.opacity = '1';
      ring.style.transform = 'scale(1.7)';
      await new Promise(r => setTimeout(r, 220));
      ring.style.opacity = '0';
      ring.style.transform = 'scale(0.6)';
    }

    const el = document.querySelector(selector);
    if (el) {
      el.focus();
      el.click();
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    }

    return { success: true };
  }

  /**
   * Simulates typewriter typing into an input field or textarea
   */
  async typeIntoField(selector, text, charDelayMs = 35) {
    const res = await this.moveToElement(selector, true);
    if (!res.success) return res;

    const el = document.querySelector(selector);
    if (!el) return { success: false };

    el.focus();
    el.value = '';

    for (const char of text) {
      el.value += char;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, charDelayMs));
    }

    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { success: true };
  }

  /**
   * Smoothly scrolls the page up, down, or to a specific section
   */
  async scroll(direction = 'down', targetSelector = null) {
    if (targetSelector) {
      return await this.moveToElement(targetSelector, true);
    }

    const scrollAmount = window.innerHeight * 0.7;
    const deltaY = direction === 'up' ? -scrollAmount : scrollAmount;

    window.scrollBy({ top: deltaY, behavior: 'smooth' });
    await new Promise(r => setTimeout(r, 500));
    return { success: true };
  }

  hideSpotlight() {
    if (this.spotlight) {
      this.spotlight.style.opacity = '0';
    }
  }

  destroy() {
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
  }
}
