/**
 * WebOrient DOM Scanner & Semantic Grounding Engine (v0.4.0)
 * - Assigns persistent deterministic `data-wo-id` attributes to actionable & landmark elements
 * - Resolves selectors, data-wo-id, or natural accessible labels to live DOM elements
 * - Real-time `matchElementFromSpeech(spokenText)`: maps whatever the Live Voice Agent is
 *   currently saying to the matching DOM element on screen so the Ghost Cursor highlights it automatically!
 * - Extracts structured page content, headings, pricing cards, FAQs, and tables for Q&A
 * - Filters out sensitive fields (passwords, credit cards, [data-agent-ignore])
 */
export class DOMScanner {
  constructor(options = {}) {
    this.ignoredSelectors = options.ignoredSelectors || [
      'input[type="password"]',
      'input[autocomplete*="cc-"]',
      '[data-agent-ignore]',
      '.weborient-ignore',
      '#weborient-overlay',
      '#weborient-overlay *',
      '#test-toolbar',
      '#test-toolbar *'
    ];
    this._idCounter = 1;
  }

  /**
   * Real-time Transcript-to-DOM Matcher:
   * Given a phrase currently being spoken by the Gemini Live Agent, finds the best matching
   * DOM section, card, tab, button, or form field on the active page so the Ghost Cursor
   * automatically scrolls to and highlights whatever the agent is describing!
   */
  matchElementFromSpeech(spokenText, todoChecklist = []) {
    if (!spokenText || typeof document === 'undefined') return null;
    const text = String(spokenText).toLowerCase().trim();
    if (text.length < 4) return null;

    const currentFile = window.location.pathname.split('/').pop() || 'test-demo.html';

    // 1. Check current-page To-Do checklist keywords first for high-precision section matching
    const pageTodos = (todoChecklist || []).filter(t => t.page === currentFile);
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

    // 2. Match against interactive controls, cards, tabs, headings, and sections on the page
    const candidates = this._querySelectorAllDeep(
      'section[id], .pricing-card, [role="tab"], [role="switch"], [data-carousel], details[id], form[id], button[id], input[id], select[id], h2, h3'
    ).filter(el => !this._isIgnored(el) && this._isVisible(el, true));

    let bestEl = null;
    let bestScore = 0;
    let bestLabel = '';

    for (const el of candidates) {
      const label = (this._extractHeading(el) || this._getAccessibleLabel(el) || '').toLowerCase();
      const idStr = (el.id || '').replace(/[-_]/g, ' ').toLowerCase();
      if (!label && !idStr) continue;

      let score = 0;
      // Check significant words (>= 4 chars)
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
      const targetNode = bestEl.closest('section[id], .pricing-card, details[id]') || bestEl;
      return {
        element: targetNode,
        selector: this._getUniqueSelector(targetNode),
        title: bestLabel || this._extractHeading(targetNode)
      };
    }

    return null;
  }

  /**
   * Resolves a selector, data-wo-id, element ID, or accessible label to a DOM element
   */
  resolveElement(target) {
    if (!target) return null;
    if (target instanceof Element) return target;

    const raw = String(target).trim();
    if (!raw) return null;

    if (/^wo-\d+$/i.test(raw)) {
      const byWo = document.querySelector(`[data-wo-id="${raw.toLowerCase()}"]`);
      if (byWo && !this._isIgnored(byWo)) return byWo;
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
      } else if (label.includes(needle) || (needle.includes(label) && label.length > 2)) {
        score = 75;
      } else if (idAttr.includes(needle) || nameAttr.includes(needle)) {
        score = 60;
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = el;
      }
    }

    return bestMatch;
  }

  /**
   * Scans and returns an array of interactive elements with rich state & selectors
   */
  scan(options = {}) {
    const includeOffscreen = Boolean(options.includeOffscreen);
    const selectorString = [
      'button',
      'a[href]',
      'input',
      'select',
      'textarea',
      'summary',
      '[role="button"]',
      '[role="tab"]',
      '[role="switch"]',
      '[role="slider"]',
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

        const item = {
          woId,
          selector: this._getUniqueSelector(el),
          tag: el.tagName.toLowerCase(),
          type: el.type || el.getAttribute('role') || null,
          role: el.getAttribute('role') || null,
          label: this._getAccessibleLabel(el),
          inViewport,
          isInteractive: true,
          disabled: Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true')
        };

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

    const sectionNodes = Array.from(
      document.querySelectorAll('section, article, main, [data-section], .pricing-card, details')
    ).filter(el => !this._isIgnored(el) && this._isVisible(el, true));

    const sections = sectionNodes.map(sec => {
      const woId = this._ensureWoId(sec);
      const heading = this._extractHeading(sec);
      const text = this._cleanText(sec.innerText || '', 600);
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
      matchingSections: filteredSections.length > 0 ? filteredSections : sections.slice(0, 8),
      manifestKnowledge: manifestMatches.slice(0, 6)
    };
  }

  captureStateSnapshot() {
    const visibleInteractive = this.scan({ includeOffscreen: false });
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
      visibleInteractiveCount: visibleInteractive.length,
      invalidFields
    };
  }

  _getCarouselState(carouselEl) {
    const slides = Array.from(carouselEl.querySelectorAll('[data-carousel-slide], .carousel-slide'));
    const activeIndex = slides.findIndex(
      s => s.classList.contains('active') || s.getAttribute('aria-hidden') === 'false' || !s.classList.contains('hidden')
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
    return el.getAttribute('data-wo-id');
  }

  _isVisible(el, includeOffscreen = false) {
    if (!el || !(el instanceof Element)) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) {
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
    return false;
  }

  _getAccessibleLabel(el) {
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

    const placeholder = el.getAttribute('placeholder');
    if (placeholder) return placeholder.trim();

    const title = el.getAttribute('title') || el.getAttribute('data-tooltip');
    if (title) return title.trim();

    const text = el.innerText || el.value || '';
    return text.replace(/\s+/g, ' ').trim().slice(0, 80);
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
    if (h) return h.innerText.trim();
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
      if (node.shadowRoot) {
        results.push(...this._querySelectorAllDeep(selector, node.shadowRoot));
      }
    }
    return results;
  }

  _queryShadowRoots(selector, root = document.body) {
    if (!root) return null;
    const allNodes = root.querySelectorAll('*');
    for (const node of allNodes) {
      if (node.shadowRoot) {
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
      'button, a, input, select, textarea, summary, section, article, [role], [data-tab], [data-carousel], h1, h2, h3, h4'
    );
  }
}
