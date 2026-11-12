/**
 * WebOrient DOM Scanner & Semantic Grounding Engine (v1.0.0 — Full-Page, Popup, Iframe & PII/OTP Security Edition)
 * - Assigns persistent deterministic `data-wo-id` attributes to EVERY actionable element, popup, banner, and close button
 * - Strict Sensitive Field Guardrail: Blocks passwords, credit cards, CVV/CVC, bank account/IFSC/UPI PINs,
 *   OTP/2FA inputs (`autocomplete="one-time-code"`), and Government IDs (`Aadhaar`, `PAN`, `SSN`, `Passport`, `GSTIN`)
 * - Cross-Origin Iframe Indexing: Detects embedded `<iframe>` widgets (Calendly, Stripe, Typeform, YouTube, HubSpot)
 *   so the agent spotlights the iframe container and guides the visitor verbally without false click failures
 */
export class DOMScanner {
  constructor(options = {}) {
    this.ignoredSelectors = options.ignoredSelectors || [
      'input[type="password"]',
      'input[autocomplete*="cc-"]',
      'input[autocomplete="one-time-code"]',
      '[data-agent-ignore]',
      '.weborient-ignore',
      '#weborient-overlay',
      '#weborient-overlay *',
      '#weborient-shadow-host',
      '#test-toolbar',
      '#test-toolbar *'
    ];
    this.sensitiveFieldRegex = /\b(password|passwd|cc-number|cc-csc|cc-exp|card.?num|credit.?card|debit.?card|cvv|cvc|iban|routing.?num|ifsc|account.?num|upi.?pin|one-time-code|otp|2fa|totp|aadhaar|aadhar|pan.?card|pan.?num|ssn|social.?security|passport.?num|gstin)\b/i;
    this._idCounter = 1;
    this._woIdMetaMap = new Map();
  }

  matchElementFromSpeech(spokenText, todoChecklist = []) {
    if (!spokenText || typeof document === 'undefined') return null;
    const text = String(spokenText).toLowerCase().trim();
    if (text.length < 4) return null;

    const activePopups = this.scanActiveOverlaysAndPopups();
    if (activePopups.length > 0) {
      const topPopup = activePopups[0];
      if (/\b(close|band|dismiss|cancel|exit|hatay|hatao)\b/i.test(text) && topPopup.closeButtonSelector) {
        const closeEl = this.resolveElement(topPopup.closeButtonSelector);
        if (closeEl) {
          return {
            element: closeEl,
            selector: topPopup.closeButtonSelector,
            title: topPopup.title ? `Close ${topPopup.title}` : 'Close'
          };
        }
      }
    }

    const currentFile = window.location.pathname.split('/').pop() || window.location.pathname || '/';
    const pageTodos = (todoChecklist || []).filter(t => !t.page || t.page === currentFile || t.page === window.location.pathname);
    for (const todo of pageTodos) {
      if (Array.isArray(todo.keywords)) {
        const hit = todo.keywords.some(kw => text.includes(kw.toLowerCase()));
        if (hit) {
          const el = this.resolveElement(todo.selector);
          if (el) {
            return {
              element: el,
              selector: todo.selector,
              title: todo.title,
              todoId: todo.id
            };
          }
        }
      }
    }

    const candidates = this._querySelectorAllDeep(
      'section[id], [id*="modal"], [id*="drawer"], [id*="calculator"], .pricing-card, [role="tab"], [role="switch"], [data-carousel], details[id], form, iframe, button, input, select, h2, h3, h4'
    ).filter(el => !this._isIgnored(el) && this._isVisible(el, true));

    let bestEl = null;
    let bestScore = 0;
    let bestLabel = '';

    for (const el of candidates) {
      const label = (this._extractHeading(el) || this._getAccessibleLabel(el) || '').toLowerCase();
      const idStr = (el.id || '').replace(/[-_]/g, ' ').toLowerCase();
      if (!label && !idStr) continue;

      let score = 0;
      const words = `${label} ${idStr}`.split(/\s+/).filter(w => w.length >= 4 && !['section', 'button', 'input', 'select', 'table'].includes(w));
      for (const w of words) {
        if (text.includes(w)) score += 25;
      }

      if (label.length > 4 && text.includes(label)) score += 60;

      if (score > bestScore && score >= 35) {
        bestScore = score;
        bestEl = el;
        bestLabel = this._extractHeading(el) || this._getAccessibleLabel(el);
      }
    }

    if (bestEl) {
      const targetNode = bestEl.closest('section[id], [id*="modal"], [id*="drawer"], .pricing-card, details[id]') || bestEl;
      return {
        element: targetNode,
        selector: this._getUniqueSelector(targetNode),
        title: bestLabel || this._extractHeading(targetNode)
      };
    }

    return null;
  }

  scanActiveOverlaysAndPopups() {
    if (typeof document === 'undefined') return [];
    const popupSelectors = [
      '[role="dialog"]',
      '[aria-modal="true"]',
      '[role="alertdialog"]',
      '#scheduler-booking-modal',
      '#personalize-drawer',
      '[id*="modal" i]',
      '[id*="popup" i]',
      '[id*="drawer" i]',
      '[id*="banner" i]',
      '[class*="modal" i]',
      '[class*="popup" i]',
      '[class*="drawer" i]',
      '.col-span-full.bg-ink',
      'div.fixed.inset-0:not(#weborient-overlay)',
      'div.absolute.inset-x-0.z-20'
    ].join(', ');

    const rawNodes = Array.from(document.querySelectorAll(popupSelectors))
      .filter(el => !this._isIgnored(el) && this._isVisible(el, false));

    const results = [];
    for (const node of rawNodes) {
      const woId = this._ensureWoId(node);
      const selector = this._getUniqueSelector(node);
      const title = this._extractHeading(node) || node.id || 'Active Popup / Overlay';

      let closeBtn = node.querySelector(
        'button[aria-label*="close" i], button[aria-label*="dismiss" i], button[title*="close" i], [data-dismiss], [data-close]'
      );
      if (!closeBtn) {
        const allBtns = Array.from(node.querySelectorAll('button, [role="button"]'));
        closeBtn = allBtns.find(b => this._isCloseOrDismissButton(b)) || null;
      }

      let closeButtonSelector = null;
      if (closeBtn) {
        this._ensureWoId(closeBtn);
        closeButtonSelector = this._getUniqueSelector(closeBtn);
      }

      const controls = Array.from(node.querySelectorAll('button, a[href], input, select, textarea, [role="combobox"], iframe'))
        .filter(c => !this._isIgnored(c) && this._isVisible(c, true))
        .slice(0, 25)
        .map(c => {
          this._ensureWoId(c);
          return {
            selector: this._getUniqueSelector(c),
            tag: c.tagName.toLowerCase(),
            type: c.type || c.getAttribute('role') || null,
            label: this._getAccessibleLabel(c)
          };
        });

      results.push({
        woId,
        selector,
        title,
        closeButtonSelector,
        textSummary: this._cleanText(node.innerText || '', 320),
        controls
      });
    }
    return results;
  }

  discoverSiteRoutes() {
    if (typeof document === 'undefined') return [];
    const routes = new Map();

    document.querySelectorAll('a[href]').forEach(a => {
      if (this._isIgnored(a)) return;
      const href = (a.getAttribute('href') || '').trim();
      if (!href || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
      const label = this._getAccessibleLabel(a) || href;
      const selector = this._getUniqueSelector(a);
      if (!routes.has(href)) {
        routes.set(href, { path: href, label, selector, kind: href.startsWith('#') ? 'anchor' : 'link' });
      }
    });

    document.querySelectorAll('header button, nav button, #hero button, footer button, #proposal-personalizer-toggle').forEach(btn => {
      if (this._isIgnored(btn) || !this._isVisible(btn, true)) return;
      const label = this._getAccessibleLabel(btn);
      if (!label) return;
      const selector = this._getUniqueSelector(btn);
      routes.set(`btn:${selector}`, { path: selector, label, selector, kind: 'spa-trigger' });
    });

    return Array.from(routes.values()).slice(0, 35);
  }

  resolveElement(target) {
    if (!target) return null;
    if (target instanceof Element) return target;

    const raw = String(target).trim();
    if (!raw) return null;

    const woAttrMatch = raw.match(/^\[?data-wo-id=["']?(wo-\d+)["']?\]?$/i) || raw.match(/^(wo-\d+)$/i);
    if (woAttrMatch) {
      const woId = woAttrMatch[1].toLowerCase();
      const byWo = document.querySelector(`[data-wo-id="${woId}"]`);
      if (byWo && !this._isIgnored(byWo)) return byWo;

      // Fallback when React/SPA re-render stripped or shifted data-wo-id: recover via cached element metadata
      const cachedMeta = this._woIdMetaMap.get(woId);
      if (cachedMeta) {
        const candidates = this._collectAllCandidateElements();
        let bestMetaEl = null;
        let bestMetaScore = 0;
        for (const el of candidates) {
          if (this._isIgnored(el) || !this._isVisible(el, true)) continue;
          const existingWo = el.getAttribute('data-wo-id');
          if (existingWo && existingWo !== woId) continue;
          let s = 0;
          const lbl = this._getAccessibleLabel(el).toLowerCase();
          const tag = el.tagName.toLowerCase();
          const secNode = el.closest('section[id], [id*="modal"], [id*="drawer"], header, footer');
          const secId = secNode ? (secNode.id || secNode.tagName.toLowerCase()) : null;
          if (cachedMeta.label && lbl === cachedMeta.label.toLowerCase()) s += 90;
          else if (cachedMeta.label && lbl && (lbl.includes(cachedMeta.label.toLowerCase()) || cachedMeta.label.toLowerCase().includes(lbl))) s += 55;
          if (cachedMeta.tag && tag === cachedMeta.tag) s += 20;
          if (cachedMeta.section && secId === cachedMeta.section) s += 25;
          if (cachedMeta.name && (el.getAttribute('name') || '') === cachedMeta.name) s += 65;
          if (s > bestMetaScore && s >= 65) {
            bestMetaScore = s;
            bestMetaEl = el;
          }
        }
        if (bestMetaEl) {
          bestMetaEl.setAttribute('data-wo-id', woId);
          return bestMetaEl;
        }
      }
    }

    try {
      const el = document.querySelector(raw);
      if (el && !this._isIgnored(el)) return el;
    } catch (_) {}

    if (!raw.startsWith('#') && !raw.includes(' ')) {
      const byId = document.getElementById(raw);
      if (byId && !this._isIgnored(byId)) return byId;
    }

    const shadowMatch = this._queryShadowRoots(raw);
    if (shadowMatch && !this._isIgnored(shadowMatch)) return shadowMatch;

    const needle = raw.toLowerCase();

    if (/\b(close|dismiss|band|exit)\b/i.test(needle)) {
      const popups = this.scanActiveOverlaysAndPopups();
      for (const p of popups) {
        if (p.closeButtonSelector) {
          const btn = document.querySelector(p.closeButtonSelector);
          if (btn) return btn;
        }
      }
    }

    const candidates = this._collectAllCandidateElements();
    let bestMatch = null;
    let bestScore = 0;

    for (const el of candidates) {
      if (this._isIgnored(el) || !this._isVisible(el, true)) continue;
      const label = this._getAccessibleLabel(el).toLowerCase();
      const nameAttr = (el.getAttribute('name') || '').toLowerCase();
      const idAttr = (el.id || '').toLowerCase();

      let score = 0;
      if (label === needle || nameAttr === needle || idAttr === needle) {
        score = 100;
      } else if (label && (label.includes(needle) || (needle.includes(label) && label.length > 2))) {
        score = 75;
      } else if ((idAttr && idAttr.includes(needle)) || (nameAttr && nameAttr.includes(needle))) {
        score = 60;
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = el;
      }
    }

    return bestMatch;
  }

  scan(options = {}) {
    const includeOffscreen = Boolean(options.includeOffscreen);
    const selectorString = [
      'button',
      'a[href]',
      'input',
      'select',
      'textarea',
      'summary',
      'iframe',
      '[role="button"]',
      '[role="tab"]',
      '[role="switch"]',
      '[role="slider"]',
      '[role="combobox"]',
      '[role="option"]',
      '[data-carousel]',
      '[data-tab]',
      '[data-agent-action]',
      '[contenteditable="true"]'
    ].join(', ');

    const elements = this._querySelectorAllDeep(selectorString);

    return elements
      .filter(el => this._isVisible(el, includeOffscreen) && !this._isIgnored(el))
      .map(el => {
        const woId = this._ensureWoId(el);
        const rect = el.getBoundingClientRect();
        const inViewport = (
          rect.top < window.innerHeight &&
          rect.bottom > 0 &&
          rect.left < window.innerWidth &&
          rect.right > 0
        );

        const parentSection = el.closest('section[id], [id*="modal"], [id*="drawer"], header, footer');
        const contextId = parentSection ? (parentSection.id || parentSection.tagName.toLowerCase()) : null;

        const item = {
          woId,
          selector: this._getUniqueSelector(el),
          tag: el.tagName.toLowerCase(),
          type: el.type || el.getAttribute('role') || null,
          role: el.getAttribute('role') || null,
          label: this._getAccessibleLabel(el),
          section: contextId,
          inViewport,
          isInteractive: true,
          disabled: Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true')
        };

        if (el.tagName === 'IFRAME') {
          item.isIframeEmbed = true;
          item.iframeSrc = (el.getAttribute('src') || '').slice(0, 140);
        }

        if (this._isCloseOrDismissButton(el)) {
          item.isCloseButton = true;
        }

        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
          if (el.type === 'checkbox' || el.type === 'radio') {
            item.checked = Boolean(el.checked);
          } else {
            item.value = el.value || '';
          }
          if (el.tagName === 'SELECT') {
            item.options = Array.from(el.options).map(o => ({
              value: o.value,
              label: o.text.trim(),
              selected: o.selected
            }));
          }
          if (el.type === 'range') {
            item.min = el.min || '0';
            item.max = el.max || '100';
            item.step = el.step || '1';
          }
          if (typeof el.checkValidity === 'function') {
            item.valid = el.checkValidity();
            item.validationMessage = el.validationMessage || null;
          }
        }

        if (el.getAttribute('role') === 'tab' || el.hasAttribute('data-tab')) {
          item.active = el.getAttribute('aria-selected') === 'true' || el.classList.contains('active');
        }

        if (el.getAttribute('role') === 'switch') {
          item.checked = el.getAttribute('aria-checked') === 'true';
        }

        if (el.hasAttribute('data-carousel')) {
          item.carouselState = this._getCarouselState(el);
        }

        return item;
      });
  }

  readPageContent(options = {}) {
    const query = (options.query || '').trim().toLowerCase();
    const targetSelector = options.selector || '';
    const manifest = options.manifest || null;

    if (targetSelector) {
      const targetEl = this.resolveElement(targetSelector);
      if (targetEl && !this._isIgnored(targetEl)) {
        return {
          success: true,
          selector: this._getUniqueSelector(targetEl),
          woId: this._ensureWoId(targetEl),
          title: this._extractHeading(targetEl),
          text: this._cleanText(targetEl.innerText || targetEl.textContent || '', 1500),
          interactiveChildCount: targetEl.querySelectorAll('button, a, input, select, textarea').length
        };
      }
    }

    let sectionNodes = Array.from(
      document.querySelectorAll('section, article, main, [data-section], #roi-savings-calculator, #scheduler-booking-modal, #personalize-drawer, .pricing-card, details')
    ).filter(el => !this._isIgnored(el) && this._isVisible(el, true));

    if (sectionNodes.length === 0) {
      sectionNodes = Array.from(
        document.querySelectorAll('div.fixed.inset-0:not(#weborient-overlay), div.absolute.inset-x-0.z-20, #root > div')
      ).filter(el => !this._isIgnored(el) && this._isVisible(el, true));
    }

    const sections = sectionNodes.map(sec => {
      const woId = this._ensureWoId(sec);
      const heading = this._extractHeading(sec);
      const text = this._cleanText(sec.innerText || '', 650);
      const rect = sec.getBoundingClientRect();
      const inViewport = rect.top < window.innerHeight && rect.bottom > 0;

      return {
        woId,
        selector: this._getUniqueSelector(sec),
        id: sec.id || null,
        heading,
        inViewport,
        summary: text
      };
    });

    const filteredSections = query
      ? sections.filter(s =>
          (s.heading && s.heading.toLowerCase().includes(query)) ||
          (s.summary && s.summary.toLowerCase().includes(query)) ||
          (s.id && s.id.toLowerCase().includes(query))
        )
      : sections;

    const manifestMatches = [];
    if (manifest) {
      if (Array.isArray(manifest.knowledgeBase)) {
        for (const kb of manifest.knowledgeBase) {
          const hay = `${kb.topic || ''} ${kb.question || ''} ${kb.answer || ''}`.toLowerCase();
          if (!query || hay.includes(query) || query.split(/\s+/).some(w => w.length > 3 && hay.includes(w))) {
            manifestMatches.push(kb);
          }
        }
      }
      if (Array.isArray(manifest.pages)) {
        for (const page of manifest.pages) {
          const hay = `${page.title || ''} ${page.summary || ''} ${(page.keywords || []).join(' ')}`.toLowerCase();
          if (!query || hay.includes(query)) {
            manifestMatches.push({
              route: page.route,
              file: page.file,
              title: page.title,
              summary: page.summary
            });
          }
        }
      }
    }

    return {
      success: true,
      pageTitle: document.title,
      currentUrl: window.location.pathname + window.location.hash,
      activePopups: this.scanActiveOverlaysAndPopups(),
      matchingSections: filteredSections.length > 0 ? filteredSections : sections.slice(0, 14),
      manifestKnowledge: manifestMatches.slice(0, 8)
    };
  }

  captureStateSnapshot() {
    const visibleInteractive = this.scan({ includeOffscreen: false });
    const activePopups = this.scanActiveOverlaysAndPopups();
    const invalidFields = visibleInteractive
      .filter(item => item.valid === false)
      .map(item => ({
        selector: item.selector,
        label: item.label,
        validationMessage: item.validationMessage
      }));

    let activeSection = null;
    const sections = Array.from(document.querySelectorAll('section[id], main[id], [data-section]'));
    const viewportCenter = window.innerHeight / 2;
    let minDistance = Infinity;

    for (const sec of sections) {
      if (this._isIgnored(sec)) continue;
      const rect = sec.getBoundingClientRect();
      const center = rect.top + rect.height / 2;
      const dist = Math.abs(center - viewportCenter);
      if (dist < minDistance && rect.bottom > 0 && rect.top < window.innerHeight) {
        minDistance = dist;
        activeSection = sec.id || sec.getAttribute('data-section') || this._extractHeading(sec);
      }
    }

    return {
      url: window.location.pathname + window.location.hash,
      scrollY: Math.round(window.scrollY),
      activeSection,
      activePopups: activePopups.map(p => ({ selector: p.selector, title: p.title, closeButtonSelector: p.closeButtonSelector })),
      visibleInteractiveCount: visibleInteractive.length,
      invalidFields
    };
  }

  _isCloseOrDismissButton(el) {
    if (!el || !(el instanceof Element)) return false;
    const aria = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''} ${el.className || ''}`.toLowerCase();
    if (/\b(close|dismiss|cancel)\b/.test(aria)) return true;
    const txt = (el.innerText || '').trim();
    if (txt === '×' || txt === '✕' || txt === '✖' || /^close$/i.test(txt)) return true;
    const svg = el.querySelector('svg');
    if (svg) {
      const svgClass = (svg.getAttribute('class') || '').toLowerCase();
      if (svgClass.includes('lucide-x') || svgClass.includes('icon-x') || svgClass.includes('close')) {
        return true;
      }
      const paths = Array.from(svg.querySelectorAll('path, line')).map(p => p.getAttribute('d') || '').join(' ');
      if (paths.includes('18 6') && paths.includes('6 18')) {
        return true;
      }
    }
    return false;
  }

  _getCarouselState(carouselEl) {
    const slides = Array.from(carouselEl.querySelectorAll('[data-carousel-slide], .carousel-slide, .swiper-slide, .embla__slide'));
    const activeIndex = slides.findIndex(
      s => s.classList.contains('active') || s.classList.contains('swiper-slide-active') || s.getAttribute('aria-hidden') === 'false' || !s.classList.contains('hidden')
    );
    return {
      totalSlides: slides.length,
      activeIndex: activeIndex >= 0 ? activeIndex : 0,
      activeSlideTitle: slides[activeIndex >= 0 ? activeIndex : 0]?.innerText?.trim()?.split('\n')[0] || null
    };
  }

  _ensureWoId(el) {
    if (!el.getAttribute('data-wo-id')) {
      el.setAttribute('data-wo-id', `wo-${this._idCounter++}`);
    }
    const woId = el.getAttribute('data-wo-id');
    try {
      const lbl = this._getAccessibleLabel(el);
      const secNode = el.closest('section[id], [id*="modal"], [id*="drawer"], header, footer');
      const secId = secNode ? (secNode.id || secNode.tagName.toLowerCase()) : null;
      if (lbl || el.getAttribute('name')) {
        this._woIdMetaMap.set(woId, {
          label: lbl,
          tag: el.tagName.toLowerCase(),
          section: secId,
          name: el.getAttribute('name') || null
        });
      }
    } catch (_) {}
    return woId;
  }

  _isVisible(el, includeOffscreen = false) {
    if (!el || !(el instanceof Element)) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') {
      return false;
    }
    const isInteractive = /^(BUTTON|A|INPUT|SELECT|TEXTAREA|IFRAME)$/.test(el.tagName);
    if (!isInteractive && parseFloat(style.opacity) === 0) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;

    if (!includeOffscreen) {
      const margin = 100;
      if (
        rect.bottom < -margin ||
        rect.top > window.innerHeight + margin ||
        rect.right < -margin ||
        rect.left > window.innerWidth + margin
      ) {
        return false;
      }
    }
    return true;
  }

  _isIgnored(el) {
    if (!el || !(el instanceof Element)) return true;
    for (const pattern of this.ignoredSelectors) {
      try {
        if (el.matches(pattern) || el.closest(pattern)) {
          return true;
        }
      } catch (_) {}
    }
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
      const fieldMeta = [
        el.getAttribute('name') || '',
        el.id || '',
        el.getAttribute('placeholder') || '',
        el.getAttribute('aria-label') || '',
        el.getAttribute('autocomplete') || '',
        el.getAttribute('data-testid') || ''
      ].join(' ');
      if (this.sensitiveFieldRegex.test(fieldMeta)) {
        return true;
      }
    }
    return false;
  }

  _getAccessibleLabel(el) {
    if (el.tagName === 'IFRAME') {
      const title = (el.getAttribute('title') || el.getAttribute('aria-label') || '').trim();
      const src = (el.getAttribute('src') || '').toLowerCase();
      if (src.includes('calendly')) return title || 'Calendly Booking Calendar (Embedded Iframe)';
      if (src.includes('stripe')) return title || 'Stripe Secure Checkout (Embedded Iframe)';
      if (src.includes('typeform')) return title || 'Typeform Interactive Form (Embedded Iframe)';
      if (src.includes('youtube') || src.includes('vimeo')) return title || 'Embedded Video Player (Iframe)';
      if (src.includes('hubspot')) return title || 'HubSpot Booking / Form Widget (Iframe)';
      return title || `Embedded Interactive Widget (${src.split('/')[2] || 'Iframe'})`;
    }

    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim();

    const ariaLabelledBy = el.getAttribute('aria-labelledby');
    if (ariaLabelledBy) {
      const refEl = document.getElementById(ariaLabelledBy);
      if (refEl) return refEl.innerText.trim();
    }

    if (el.id) {
      const labelEl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (labelEl) return labelEl.innerText.trim();
    }

    const parentLabel = el.closest('label');
    if (parentLabel) {
      const cloneText = parentLabel.innerText.trim();
      if (cloneText) return cloneText.slice(0, 80);
    }

    if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') {
      const prevLabel = el.previousElementSibling;
      if (prevLabel && (prevLabel.tagName === 'LABEL' || prevLabel.tagName === 'SPAN' || prevLabel.tagName === 'DIV')) {
        const lblTxt = prevLabel.innerText.replace(/\s+/g, ' ').trim();
        const ph = el.getAttribute('placeholder');
        if (lblTxt) return ph ? `${lblTxt} (${ph})` : lblTxt.slice(0, 80);
      }
      const wrapperLabel = el.parentElement?.querySelector('label');
      if (wrapperLabel) {
        const lblTxt = wrapperLabel.innerText.replace(/\s+/g, ' ').trim();
        const ph = el.getAttribute('placeholder');
        if (lblTxt) return ph ? `${lblTxt} (${ph})` : lblTxt.slice(0, 80);
      }
    }

    const placeholder = el.getAttribute('placeholder');
    if (placeholder) return placeholder.trim();

    const title = el.getAttribute('title') || el.getAttribute('data-tooltip');
    if (title) return title.trim();

    const text = (el.innerText || el.value || '').replace(/\s+/g, ' ').trim();
    if (text) return text.slice(0, 90);

    if (this._isCloseOrDismissButton(el)) {
      const modalParent = el.closest('[id*="modal"], [id*="drawer"], [role="dialog"], .col-span-full');
      const modalTitle = modalParent ? (this._extractHeading(modalParent) || modalParent.id) : 'Popup';
      return `Close ${modalTitle} (X)`;
    }

    const svg = el.querySelector('svg');
    if (svg) {
      const cls = (svg.getAttribute('class') || '').toLowerCase();
      if (cls.includes('arrow-left') || cls.includes('chevron-left')) return 'Previous';
      if (cls.includes('arrow-right') || cls.includes('chevron-right')) return 'Next';
      if (cls.includes('send')) return 'Send';
      if (cls.includes('mic')) return 'Microphone / Voice';
    }

    return '';
  }

  _getUniqueSelector(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;
    if (el.getAttribute('data-agent-id')) {
      return `[data-agent-id="${el.getAttribute('data-agent-id')}"]`;
    }
    if (el.getAttribute('data-tab')) {
      return `[data-tab="${el.getAttribute('data-tab')}"]`;
    }
    if (el.name && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) {
      return `${el.tagName.toLowerCase()}[name="${el.name}"]`;
    }
    const woId = this._ensureWoId(el);
    return `[data-wo-id="${woId}"]`;
  }

  _extractHeading(el) {
    if (/^H[1-6]$/.test(el.tagName)) return el.innerText.trim();
    const h = el.querySelector('h1, h2, h3, h4, summary, [data-title]');
    if (h) return h.innerText.replace(/\s+/g, ' ').trim();
    return el.getAttribute('aria-label') || el.id || '';
  }

  _cleanText(raw, maxLength = 600) {
    const cleaned = String(raw).replace(/\s+/g, ' ').trim();
    return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}...` : cleaned;
  }

  _querySelectorAllDeep(selector, root = document.body) {
    if (!root) return [];
    const results = Array.from(root.querySelectorAll(selector));
    const allNodes = root.querySelectorAll('*');
    for (const node of allNodes) {
      if (node.shadowRoot && node.id !== 'weborient-shadow-host') {
        results.push(...this._querySelectorAllDeep(selector, node.shadowRoot));
      }
    }
    return results;
  }

  _queryShadowRoots(selector, root = document.body) {
    if (!root) return null;
    const allNodes = root.querySelectorAll('*');
    for (const node of allNodes) {
      if (node.shadowRoot && node.id !== 'weborient-shadow-host') {
        try {
          const found = node.shadowRoot.querySelector(selector);
          if (found) return found;
        } catch (_) {}
        const nested = this._queryShadowRoots(selector, node.shadowRoot);
        if (nested) return nested;
      }
    }
    return null;
  }

  _collectAllCandidateElements() {
    return this._querySelectorAllDeep(
      'button, a, input, select, textarea, summary, iframe, section, article, [role], [data-tab], [data-carousel], h1, h2, h3, h4'
    );
  }
}
