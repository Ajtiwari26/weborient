/**
 * WebOrient Ghost Cursor & Deterministic UI Actuator (v0.5.0 — DeployMate Shadow DOM Edition)
 * - Encapsulated inside an open ShadowRoot (`#weborient-shadow-host` on `document.documentElement`)
 *   so client website CSS (Tailwind/Bootstrap resets, body transforms) never distorts the cursor or spotlight
 * - DeployMate Signal (`#E6391E`) & Ink (`#0A0A0A`) Brutalist-Editorial Coachmark & Spotlight aesthetic
 * - True Cubic Bézier + Fitts's Law human-like 60fps cursor trajectory with tip hotspot offset
 * - Exact smooth scroll completion listener (`_smoothScrollTo`) so elements are 100% settled in center
 * - Cross-page cursor coordinate persistence (`weborient_cursor_pos_v5`)
 * - React/Vue/Angular compatible form filling (`HTMLInputElement.prototype.value` setter)
 */

const CURSOR_POS_STORAGE_KEY = 'weborient_cursor_pos_v5';

export class GhostCursor {
  constructor(options = {}) {
    this.primaryColor = options.primaryColor || '#E6391E';
    this.accentColor = options.accentColor || '#0A0A0A';
    this.cursorStyle = options.cursorStyle || 'deploymate-signal';
    this.scanner = options.scanner || null;

    this.currentPosition = this._loadStoredPosition();
    this.isMoving = false;
    this.activeTarget = null;
    this.activeExplanation = null;
    this._abortController = null;
    this._rafId = null;
    this._moveCancelResolve = null;

    this._initOverlay();
  }

  _loadStoredPosition() {
    if (typeof window === 'undefined') return { x: 500, y: 400 };
    try {
      const raw = sessionStorage.getItem(CURSOR_POS_STORAGE_KEY) || localStorage.getItem(CURSOR_POS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
          return {
            x: Math.max(12, Math.min(window.innerWidth - 24, parsed.x)),
            y: Math.max(12, Math.min(window.innerHeight - 24, parsed.y))
          };
        }
      }
    } catch (_) {}
    return {
      x: Math.round(window.innerWidth / 2),
      y: Math.round(window.innerHeight / 2)
    };
  }

  _saveCurrentPosition() {
    if (typeof window === 'undefined') return;
    try {
      const payload = JSON.stringify({
        x: Math.round(this.currentPosition.x),
        y: Math.round(this.currentPosition.y)
      });
      sessionStorage.setItem(CURSOR_POS_STORAGE_KEY, payload);
      localStorage.setItem(CURSOR_POS_STORAGE_KEY, payload);
    } catch (_) {}
  }

  /**
   * Mounts or reuses `#weborient-shadow-host` on `document.documentElement` (`<html>`)
   * with an open ShadowRoot so host website CSS rules can never collide with WebOrient UI.
   */
  getOrCreateShadowRoot() {
    if (typeof document === 'undefined') return null;
    let host = document.getElementById('weborient-shadow-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'weborient-shadow-host';
      host.setAttribute('data-agent-ignore', 'true');
      host.style.cssText = 'all: initial; position: fixed; inset: 0; width: 0; height: 0; pointer-events: none; z-index: 2147483647;';
      (document.documentElement || document.body).appendChild(host);
    }
    return host.shadowRoot || host.attachShadow({ mode: 'open' });
  }

  _initOverlay() {
    if (typeof document === 'undefined') return;
    const legacyOverlay = document.getElementById('weborient-overlay');
    if (legacyOverlay) legacyOverlay.remove();

    this.shadowRoot = this.getOrCreateShadowRoot();
    if (!this.shadowRoot) return;

    const existing = this.shadowRoot.getElementById('weborient-overlay');
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
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    `;

    // Spotlight Element Bounding Box (DeployMate Signal #E6391E crisp architectural frame)
    this.spotlight = document.createElement('div');
    this.spotlight.id = 'weborient-spotlight';
    this.spotlight.style.cssText = `
      position: fixed;
      border: 2px solid ${this.primaryColor};
      border-radius: 6px;
      box-shadow: 0 0 0 1px rgba(10, 10, 10, 0.25), 0 0 28px ${this.primaryColor}55, inset 0 0 14px ${this.primaryColor}22;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.2s ease, top 0.12s cubic-bezier(0.215, 0.61, 0.355, 1), left 0.12s cubic-bezier(0.215, 0.61, 0.355, 1), width 0.16s cubic-bezier(0.215, 0.61, 0.355, 1), height 0.16s cubic-bezier(0.215, 0.61, 0.355, 1);
      z-index: 2147483645;
    `;

    // Floating Explanation Coachmark / Tooltip (DeployMate Ink #0A0A0A + Signal #E6391E border)
    this.tooltip = document.createElement('div');
    this.tooltip.id = 'weborient-tooltip';
    this.tooltip.style.cssText = `
      position: fixed;
      max-width: 360px;
      padding: 8px 14px;
      background: #0A0A0A;
      border: 1.5px solid ${this.primaryColor};
      border-radius: 999px;
      color: #FFFFFF;
      font-family: 'Fira Code', ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      line-height: 1.4;
      font-weight: 500;
      letter-spacing: 0.04em;
      box-shadow: 0 12px 28px -6px rgba(0, 0, 0, 0.45);
      pointer-events: none;
      opacity: 0;
      transform: translateY(4px);
      transition: opacity 0.2s ease, transform 0.2s ease, top 0.12s ease-out, left 0.12s ease-out;
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
    this.trailPath.setAttribute('stroke', this.primaryColor);
    this.trailPath.setAttribute('stroke-width', '3.5');
    this.trailPath.setAttribute('stroke-linecap', 'round');
    this.trailPath.setAttribute('stroke-dasharray', '7 5');
    this.trailPath.style.opacity = '0';
    this.trailPath.style.transition = 'opacity 0.35s ease';
    this.trailSvg.appendChild(this.trailPath);

    // Ghost Cursor Pointer (Tip hotspot at SVG (4, 3) aligned to (0, 0) via margin offset)
    this.cursor = document.createElement('div');
    this.cursor.id = 'weborient-cursor';
    this.cursor.innerHTML = `
      <div class="weborient-pointer" style="position: relative; width: 30px; height: 30px; margin-left: -4px; margin-top: -3px; transition: transform 0.18s ease-out;">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" style="filter: drop-shadow(0 4px 10px rgba(10,10,10,0.38));">
          <path d="M4 3L11 20L14.5 13.5L21 11L4 3Z" fill="${this.primaryColor}" stroke="#0A0A0A" stroke-width="1.6" stroke-linejoin="round"/>
        </svg>
        <div class="weborient-ring" style="
          position: absolute; top: -11px; left: -10px; width: 28px; height: 28px;
          border: 2.5px solid ${this.primaryColor}; border-radius: 50%;
          opacity: 0; transform: scale(0.5);
          transition: transform 0.28s ease-out, opacity 0.28s ease-out;
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
    this.shadowRoot.appendChild(this.container);

    this._boundSyncPosition = () => this._syncSpotlightPosition();
    window.addEventListener('scroll', this._boundSyncPosition, { passive: true, capture: true });
    window.addEventListener('resize', this._boundSyncPosition, { passive: true });
  }

  showSpeechBubble() {}
  hideSpeechBubble() {}

  async performSpeakingGesture(el) {
    if (!el || !document.body.contains(el)) return;
    const rect = el.getBoundingClientRect();
    const baseX = Math.max(16, Math.min(window.innerWidth - 24, rect.left + rect.width * 0.35));
    const baseY = Math.max(16, Math.min(window.innerHeight - 24, rect.top + Math.min(48, rect.height * 0.4)));
    await this.moveTo(baseX + 24, baseY - 6, 300);
    await this.moveTo(baseX, baseY, 300);
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
   * Deterministic smooth scroll that waits until window.scrollY reaches targetScrollY
   */
  async _smoothScrollTo(targetScrollY, maxWaitMs = 680) {
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const clampedTarget = Math.max(0, Math.min(maxScroll, Math.round(targetScrollY)));

    if (Math.abs(window.scrollY - clampedTarget) <= 8) {
      return;
    }

    window.scrollTo({ top: clampedTarget, behavior: 'smooth' });

    return new Promise(resolve => {
      const startTime = performance.now();
      let lastY = window.scrollY;
      let settledFrames = 0;

      const checkScroll = () => {
        const now = performance.now();
        const currentY = window.scrollY;
        this._syncSpotlightPosition();

        const dist = Math.abs(currentY - clampedTarget);
        const delta = Math.abs(currentY - lastY);
        lastY = currentY;

        if (dist <= 3) {
          resolve();
          return;
        }

        if (delta < 0.5 && (now - startTime) > 140) {
          settledFrames++;
          if (settledFrames >= 4) {
            resolve();
            return;
          }
        } else {
          settledFrames = 0;
        }

        if (now - startTime >= maxWaitMs) {
          resolve();
          return;
        }

        requestAnimationFrame(checkScroll);
      };

      requestAnimationFrame(checkScroll);
    });
  }

  /**
   * Moves cursor along a human-like Cubic Bézier trajectory with Fitts's Law easing
   */
  async moveTo(targetX, targetY, durationMs = 460) {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    if (this._moveCancelResolve) {
      const prevResolve = this._moveCancelResolve;
      this._moveCancelResolve = null;
      prevResolve();
    }

    const clampedX = Math.max(8, Math.min(window.innerWidth - 16, targetX));
    const clampedY = Math.max(8, Math.min(window.innerHeight - 16, targetY));

    const startX = this.currentPosition.x;
    const startY = this.currentPosition.y;
    const dx = clampedX - startX;
    const dy = clampedY - startY;
    const distance = Math.hypot(dx, dy);

    if (distance < 2) {
      this.currentPosition = { x: clampedX, y: clampedY };
      this.cursor.style.transform = `translate3d(${clampedX.toFixed(1)}px, ${clampedY.toFixed(1)}px, 0)`;
      this._saveCurrentPosition();
      return;
    }

    const scaledDuration = Math.min(720, Math.max(200, durationMs * (0.52 + Math.log2(distance / 65 + 1) * 0.22)));

    const nx = -dy / distance;
    const ny = dx / distance;
    const arcSign = (startX + startY) % 2 === 0 ? 1 : -1;
    const arcRadius = Math.min(75, distance * 0.18) * arcSign;

    const p1x = startX + dx * 0.28 + nx * arcRadius;
    const p1y = startY + dy * 0.28 + ny * arcRadius;

    const overshoot = distance > 180 ? 3.5 : 0;
    const p2x = startX + dx * 0.76 + nx * (arcRadius * 0.3) + (dx / distance) * overshoot;
    const p2y = startY + dy * 0.76 + ny * (arcRadius * 0.3) + (dy / distance) * overshoot;

    this.isMoving = true;
    this.cursor.style.transition = 'none';

    return new Promise(resolve => {
      this._moveCancelResolve = resolve;
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
          this._rafId = null;
          this._moveCancelResolve = null;
          this.currentPosition = { x: clampedX, y: clampedY };
          this.cursor.style.transform = `translate3d(${clampedX.toFixed(1)}px, ${clampedY.toFixed(1)}px, 0)`;
          this._saveCurrentPosition();
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

    const header = document.querySelector('#global-site-header, header, [data-site-header]');
    const isInsideHeader = header && header.contains(this.activeTarget);
    const headerBottom = (!isInsideHeader && header) ? Math.max(0, header.getBoundingClientRect().bottom) : 0;

    const pad = 6;
    const safeTop = isInsideHeader ? Math.max(4, rect.top - pad) : Math.max(headerBottom + 4, rect.top - pad);
    const safeLeft = rect.left - pad;
    const safeWidth = rect.width + pad * 2;
    const safeHeight = Math.max(0, (rect.bottom + pad) - safeTop);

    if (safeHeight <= 6 || (!isInsideHeader && rect.bottom <= headerBottom) || rect.top >= window.innerHeight) {
      this.spotlight.style.opacity = '0';
      if (this.tooltip) this.tooltip.style.opacity = '0';
      return;
    }

    this.spotlight.style.top = `${safeTop}px`;
    this.spotlight.style.left = `${safeLeft}px`;
    this.spotlight.style.width = `${safeWidth}px`;
    this.spotlight.style.height = `${safeHeight}px`;
    this.spotlight.style.opacity = '1';

    if (this.activeExplanation) {
      this.tooltip.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${this.primaryColor};flex-shrink:0;"></span>
          <span>${this._escapeHtml(this.activeExplanation)}</span>
        </div>
      `;

      // Smart boundary placement: Tooltip MUST NEVER touch or overlap the highlighted component or spotlight
      const CLEARANCE = 22; // Strict safety buffer so tooltip never touches component boundary
      const tooltipW = Math.min(380, Math.max(220, this.tooltip.offsetWidth || 280));
      const tooltipH = Math.max(34, this.tooltip.offsetHeight || 38);

      const spaceAbove = safeTop - headerBottom;
      const spaceBelow = window.innerHeight - (safeTop + safeHeight);

      let topPos;
      let leftPos = Math.max(16, Math.min(window.innerWidth - tooltipW - 16, safeLeft + (safeWidth - tooltipW) / 2));

      if (!isInsideHeader && spaceAbove >= tooltipH + CLEARANCE + 10) {
        // Place strictly above component with clear boundary
        topPos = safeTop - tooltipH - CLEARANCE;
      } else if (spaceBelow >= tooltipH + CLEARANCE + 16) {
        // Place strictly below component with clear boundary
        topPos = safeTop + safeHeight + CLEARANCE;
      } else {
        // Component is tall or near viewport edges: dock cleanly at top safe boundary below header
        topPos = Math.max(headerBottom + 16, 20);
        leftPos = Math.max(16, Math.min(window.innerWidth - tooltipW - 20, window.innerWidth - tooltipW - 24));
      }

      // Avoid collision with cursor pointer: if tooltip bounds cover current cursor hotspot, offset left
      if (
        this.currentPosition &&
        this.currentPosition.x >= leftPos - 12 &&
        this.currentPosition.x <= leftPos + tooltipW + 12 &&
        this.currentPosition.y >= topPos - 12 &&
        this.currentPosition.y <= topPos + tooltipH + 12
      ) {
        if (leftPos > window.innerWidth / 2) {
          leftPos = Math.max(16, leftPos - 60);
        } else {
          leftPos = Math.min(window.innerWidth - tooltipW - 16, leftPos + 60);
        }
      }

      this.tooltip.style.top = `${topPos}px`;
      this.tooltip.style.left = `${leftPos}px`;
      this.tooltip.style.opacity = '1';
      this.tooltip.style.transform = 'translateY(0)';
    } else {
      this.tooltip.style.opacity = '0';
    }
  }

  /**
   * Resolves landmark sections, headers, or containers down to their ACTUAL substantive component
   * (e.g., interactive tabs + code viewer, table, carousel, cards grid, form, sliders, or accordion)
   * NEVER highlights or lands on title headers, H1/H2 tags, or page section banners!
   */
  _resolveActualContent(el, explanation = '') {
    if (!el || !(el instanceof Element)) return el;

    const tag = el.tagName.toLowerCase();

    // 0. If el itself is a heading tag or title container, immediately find the actual substantive widget
    if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'header' || tag === 'nav' || el.classList.contains('pricing-header') || el.classList.contains('grid-fine')) {
      const parentScope = el.closest('section, main, article, div.space-y-24, div.space-y-12, div.space-y-8') || el.parentElement;
      if (parentScope && parentScope !== el) {
        const resolved = this._resolveActualContent(parentScope, explanation);
        if (resolved && resolved !== el) return resolved;
      }
      if (el.nextElementSibling) {
        const nextResolved = this._resolveActualContent(el.nextElementSibling, explanation);
        if (nextResolved) return nextResolved;
      }
    }

    const isSection = tag === 'section' || tag === 'article' || tag === 'main' || (el.id && el.id.includes('section'));
    if (!isSection) return el;

    // 1. Interactive Tabs / Framework Tabs / Workflow Tabs + Code/Content Viewer
    const tabWidget = el.querySelector('[role="tablist"], [data-tab-group]');
    if (tabWidget) {
      const tabsParent = tabWidget.closest('.space-y-6, .space-y-4, div:has(>[role="tablist"])') || tabWidget.parentElement;
      if (tabsParent && tabsParent !== el && !tabsParent.querySelector('h1, h2')) {
        return tabsParent;
      }
      return tabWidget;
    }

    // 2. Tables (e.g. 10-Tool API Reference Table, Latency Benchmark Table, Security Matrix, SLA)
    const tableContainer = el.querySelector('.overflow-x-auto, table');
    if (tableContainer) {
      return tableContainer;
    }

    // 3. Form (e.g. #contact-form)
    const form = el.querySelector('form');
    if (form) {
      return form;
    }

    // 4. Pricing Cards Grid / Feature Grid
    const cardsGrid = el.querySelector('#pricing-cards-grid, .pricing-grid, [data-plan="pro"], .grid:has(.pricing-card)');
    if (cardsGrid) {
      return cardsGrid;
    }

    // 5. Interactive Calculator Sliders & Result Card
    const calcGrid = el.querySelector('.grid:has(input[type="range"]), .grid:has(#roi-result-card)');
    if (calcGrid) {
      return calcGrid;
    }

    // 6. Carousel / Case-Study Showcase
    const carousel = el.querySelector('[data-carousel], .carousel');
    if (carousel) {
      return carousel;
    }

    // 7. Telemetry / Metric strips
    const telemetryStrip = el.querySelector('#telemetry-strip, .grid:has(>div>div.text-2xl)');
    if (telemetryStrip) {
      return telemetryStrip;
    }

    // 8. Accordion / FAQ Details
    const faqContainer = el.querySelector('.space-y-3:has(details), details');
    if (faqContainer) {
      return faqContainer;
    }

    // 9. First substantive content following the title header block
    const headerBlock = el.querySelector('div.space-y-2:has(h1), div.space-y-1:has(h2), .pricing-header, header, .grid-fine');
    if (headerBlock && headerBlock.nextElementSibling) {
      return headerBlock.nextElementSibling;
    }

    return el;
  }

  _computeTargetCoordinates(el, rect, headerHeight, isInsideHeader) {
    const tag = el.tagName.toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();
    const isInteractiveControl =
      tag === 'button' ||
      tag === 'a' ||
      tag === 'input' ||
      tag === 'select' ||
      tag === 'textarea' ||
      tag === 'summary' ||
      role === 'button' ||
      role === 'tab' ||
      role === 'switch' ||
      role === 'link' ||
      (rect.width <= 340 && rect.height <= 95);

    if (isInteractiveControl) {
      return {
        x: Math.max(10, Math.min(window.innerWidth - 16, rect.left + rect.width / 2)),
        y: Math.max(10, Math.min(window.innerHeight - 16, rect.top + rect.height / 2))
      };
    }

    const activeTab = el.querySelector?.('[role="tab"][aria-selected="true"], [role="tab"].active, [role="tab"]');
    if (activeTab) {
      const tabRect = activeTab.getBoundingClientRect();
      return {
        x: Math.max(10, Math.min(window.innerWidth - 16, tabRect.left + tabRect.width / 2)),
        y: Math.max(10, Math.min(window.innerHeight - 16, tabRect.top + tabRect.height / 2))
      };
    }

    const activeSlide = el.querySelector?.('[data-carousel-slide]:not(.hidden), .carousel-slide:not(.hidden)');
    if (activeSlide) {
      const slideRect = activeSlide.getBoundingClientRect();
      return {
        x: Math.max(16, Math.min(window.innerWidth - 24, slideRect.left + Math.min(slideRect.width * 0.35, 200))),
        y: Math.max(headerHeight + 20, Math.min(window.innerHeight - 24, slideRect.top + Math.min(slideRect.height * 0.4, 80)))
      };
    }

    const proCard = el.querySelector?.('#plan-pro, [data-plan="pro"], .pricing-card:nth-child(3), .pricing-card');
    if (proCard) {
      const proRect = proCard.getBoundingClientRect();
      return {
        x: Math.max(16, Math.min(window.innerWidth - 24, proRect.left + proRect.width / 2)),
        y: Math.max(headerHeight + 20, Math.min(window.innerHeight - 24, proRect.top + Math.min(proRect.height * 0.35, 90)))
      };
    }

    const firstCell = el.querySelector?.('tbody tr:first-child td:first-child, thead th:first-child');
    if (firstCell) {
      const cellRect = firstCell.getBoundingClientRect();
      return {
        x: Math.max(16, Math.min(window.innerWidth - 24, cellRect.left + cellRect.width / 2)),
        y: Math.max(headerHeight + 20, Math.min(window.innerHeight - 24, cellRect.top + cellRect.height / 2))
      };
    }

    const minTop = isInsideHeader ? 12 : headerHeight + 22;
    const xOffset = Math.min(Math.max(48, rect.width * 0.35), 240);
    const yOffset = Math.min(Math.max(36, rect.height * 0.38), 95);

    return {
      x: Math.max(16, Math.min(window.innerWidth - 24, rect.left + xOffset)),
      y: Math.max(minTop, Math.min(window.innerHeight - 36, rect.top + yOffset))
    };
  }

  async moveToElement(selector, highlight = true, explanation = null) {
    const rawEl = this._resolve(selector);
    if (!rawEl) {
      console.warn(`[WebOrient] Element not found: ${selector}`);
      return { success: false, elementFound: false, error: `Element not found: ${selector}` };
    }

    const el = this._resolveActualContent(rawEl, explanation);

    const header = document.querySelector('#global-site-header, header, [data-site-header]');
    const isInsideHeader = header && header.contains(el);
    const headerHeight = header ? Math.round(header.getBoundingClientRect().height) : 70;
    const viewportHeight = window.innerHeight;
    const usableHeight = Math.max(200, viewportHeight - headerHeight);

    if (!isInsideHeader) {
      const initialRect = el.getBoundingClientRect();
      let targetTopInViewport;
      if (initialRect.height < usableHeight) {
        targetTopInViewport = headerHeight + Math.round((usableHeight - initialRect.height) / 2);
      } else {
        targetTopInViewport = headerHeight + 20;
      }

      const targetScrollY = Math.max(0, Math.round(window.scrollY + initialRect.top - targetTopInViewport));
      if (Math.abs(window.scrollY - targetScrollY) > 14) {
        await this._smoothScrollTo(targetScrollY);
      }
    }

    if (highlight) {
      this.activeTarget = el;
      this.activeExplanation = explanation || null;
      this._syncSpotlightPosition();
    }

    const settledRect = el.getBoundingClientRect();
    const { x: targetX, y: targetY } = this._computeTargetCoordinates(el, settledRect, headerHeight, isInsideHeader);

    await this.moveTo(targetX, targetY);

    if (highlight) {
      this._syncSpotlightPosition();
    }

    el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: targetX, clientY: targetY }));
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: targetX, clientY: targetY }));
    el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, clientX: targetX, clientY: targetY }));

    return {
      success: true,
      elementFound: true,
      element: el,
      selector: typeof selector === 'string' ? selector : (el.id ? `#${el.id}` : el.tagName.toLowerCase()),
      label: el.innerText?.trim()?.slice(0, 80) || el.getAttribute('aria-label') || null,
      explanation: explanation || null
    };
  }

  async guideTour(steps = []) {
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
      const badgeText = `[0${i + 1}/0${steps.length}] ${step.explanation || 'Tour Stop'}`;
      const res = await this.moveToElement(step.selector, true, badgeText);

      const dwell = Math.min(4000, Math.max(600, step.dwellMs || 1200));
      await this._sleep(dwell);

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

  async playClickAnimation() {
    const ring = this.cursor?.querySelector('.weborient-ring');
    const pointer = this.cursor?.querySelector('.weborient-pointer');
    if (ring) {
      ring.style.opacity = '1';
      ring.style.transform = 'scale(1.85)';
    }
    if (pointer) {
      pointer.style.transform = 'scale(0.86)';
    }
    await this._sleep(190);
    if (ring) {
      ring.style.opacity = '0';
      ring.style.transform = 'scale(0.5)';
    }
    if (pointer) {
      pointer.style.transform = 'scale(1)';
    }
  }

  async click(selector, explanation = null) {
    const el = this._resolve(selector);
    if (!el) {
      return { success: false, elementFound: false, error: `Element not found: ${selector}` };
    }

    const res = await this.moveToElement(el, true, explanation);
    if (!res.success) return res;

    await this.playClickAnimation();

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

    this._syncSpotlightPosition();

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
      await this.playClickAnimation();
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
      await this.playClickAnimation();
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
      const min = parseFloat(el.min || '0');
      const max = parseFloat(el.max || '100');
      const numVal = parseFloat(String(normalizedValue).replace(/[^0-9.-]/g, ''));
      const clampedVal = Number.isFinite(numVal) ? Math.max(min, Math.min(max, numVal)) : min;

      const rect = el.getBoundingClientRect();
      const ratio = max > min ? (clampedVal - min) / (max - min) : 0.5;
      const thumbX = rect.left + Math.max(8, Math.min(rect.width - 8, rect.width * ratio));
      const thumbY = rect.top + rect.height / 2;

      await this.moveTo(thumbX, thumbY, 280);
      await this.playClickAnimation();

      this._setNativeValue(el, String(clampedVal));
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

    let nextScrollY = window.scrollY;
    if (dir === 'top') {
      nextScrollY = 0;
    } else if (dir === 'bottom') {
      nextScrollY = document.documentElement.scrollHeight - window.innerHeight;
    } else if (dir === 'up') {
      nextScrollY = Math.max(0, window.scrollY - scrollAmount);
    } else {
      nextScrollY = window.scrollY + scrollAmount;
    }

    await this._smoothScrollTo(nextScrollY);
    this._syncSpotlightPosition();

    return {
      success: true,
      action: 'scroll_page',
      direction: dir,
      scrollY: Math.round(window.scrollY)
    };
  }

  async swipeOrSwap(selector, action = 'next', targetValue = null) {
    let el = this._resolve(selector);
    if (!el) {
      return { success: false, elementFound: false, error: `Target widget not found: ${selector}` };
    }

    const act = String(action || 'next').toLowerCase();

    // 1. Range Slider
    const rangeInput = (el.tagName === 'INPUT' && el.type === 'range')
      ? el
      : el.querySelector?.('input[type="range"]');
    if (rangeInput && (el.tagName === 'INPUT' || act === 'slide' || targetValue !== null)) {
      const min = parseFloat(rangeInput.min || '0');
      const max = parseFloat(rangeInput.max || '100');
      const current = parseFloat(rangeInput.value || '0');
      const step = parseFloat(rangeInput.step || '1') || Math.max(1, (max - min) * 0.1);
      let nextVal = current;

      if (targetValue !== null && targetValue !== undefined && targetValue !== '') {
        nextVal = parseFloat(String(targetValue).replace(/[^0-9.-]/g, ''));
      } else if (act === 'next' || act === 'right' || act === 'increase') {
        nextVal = Math.min(max, current + step * 5);
      } else if (act === 'prev' || act === 'left' || act === 'decrease') {
        nextVal = Math.max(min, current - step * 5);
      }
      return await this.typeIntoField(rangeInput, String(nextVal));
    }

    // 2. Toggle Switch or Checkbox
    const switchEl = (el.getAttribute('role') === 'switch' || (el.tagName === 'INPUT' && el.type === 'checkbox'))
      ? el
      : el.querySelector?.('[role="switch"], input[type="checkbox"]');
    if (switchEl && (el === switchEl || act === 'toggle' || act === 'switch')) {
      return await this.click(switchEl, `Toggled switch`);
    }

    // 3. Tablist / Tabs
    if (
      el.getAttribute('role') === 'tablist' ||
      el.getAttribute('role') === 'tab' ||
      el.hasAttribute('data-tab') ||
      el.querySelector('[role="tab"], [data-tab]')
    ) {
      const tabContainer = (el.getAttribute('role') === 'tab' || el.hasAttribute('data-tab'))
        ? (el.closest('[role="tablist"]') || el.parentElement)
        : (el.querySelector('[role="tablist"]') || el);
      const tabs = Array.from(tabContainer.querySelectorAll('[role="tab"], [data-tab]'));

      let targetTab = (el.getAttribute('role') === 'tab' || el.hasAttribute('data-tab')) ? el : null;
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

    // 4. Carousel / Swipeable Container
    const carouselBox = el.hasAttribute('data-carousel')
      ? el
      : (el.querySelector('[data-carousel]') || el);

    await this.moveToElement(carouselBox, true, `Swiping carousel (${act})`);
    const rect = carouselBox.getBoundingClientRect();
    const cy = Math.max(24, Math.min(window.innerHeight - 24, rect.top + rect.height * 0.5));
    const isNext = act !== 'prev' && act !== 'right';
    const startX = isNext ? rect.left + rect.width * 0.76 : rect.left + rect.width * 0.24;
    const endX = isNext ? rect.left + rect.width * 0.24 : rect.left + rect.width * 0.76;

    await this._animateSwipeGesture(carouselBox, startX, cy, endX, cy);

    const searchScope = carouselBox.closest('section') || carouselBox.parentElement || document;
    const btnSelector = isNext
      ? '[data-carousel-next], .carousel-next, [aria-label*="Next" i]'
      : '[data-carousel-prev], .carousel-prev, [aria-label*="Prev" i]';
    const navBtn = carouselBox.querySelector(btnSelector) || searchScope.querySelector(btnSelector);

    if (targetValue !== null && targetValue !== undefined && targetValue !== '') {
      const idx = parseInt(targetValue, 10);
      const indicator = searchScope.querySelector(`[data-slide-to="${idx}"]`);
      if (indicator) indicator.click();
    } else if (navBtn) {
      navBtn.click();
    }

    this._syncSpotlightPosition();

    const slides = Array.from(carouselBox.querySelectorAll('[data-carousel-slide], .carousel-slide'));
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
    await this.moveTo(startX, startY, 240);

    if (this.trailPath) {
      this.trailPath.setAttribute('d', `M ${startX} ${startY} Q ${(startX + endX) / 2} ${startY - 24} ${endX} ${endY}`);
      this.trailPath.style.opacity = '0.95';
    }

    const pointer = this.cursor?.querySelector('.weborient-pointer');
    if (pointer) pointer.style.transform = 'scale(0.9)';

    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: startX, clientY: startY }));
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: startX, clientY: startY }));

    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const cx = startX + (endX - startX) * t;
      const cy = startY + (endY - startY) * t;
      el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: cx, clientY: cy }));
      el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: cx, clientY: cy }));
    }

    await this.moveTo(endX, endY, 320);

    if (pointer) pointer.style.transform = 'scale(1)';

    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: endX, clientY: endY }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: endX, clientY: endY }));

    if (this.trailPath) {
      setTimeout(() => {
        if (this.trailPath) this.trailPath.style.opacity = '0';
      }, 380);
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
    if (this._moveCancelResolve) {
      const r = this._moveCancelResolve;
      this._moveCancelResolve = null;
      r();
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
