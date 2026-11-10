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
export class GhostCursor {
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
