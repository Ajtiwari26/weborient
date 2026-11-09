/**
 * WebOrient DOM Scanner
 * Inspects visible and actionable DOM elements, filters out sensitive fields,
 * and generates clean, unambiguous CSS selectors for model consumption.
 */
export class DOMScanner {
  constructor(options = {}) {
    this.ignoredSelectors = options.ignoredSelectors || [
      'input[type="password"]',
      'input[autocomplete*="cc-"]',
      '[data-agent-ignore]',
      '.weborient-ignore'
    ];
  }

  /**
   * Scans and returns an array of interactive elements currently visible
   */
  scan() {
    const selectorString = 'button, a, input, select, textarea, [role="button"], [data-agent-action]';
    const elements = Array.from(document.querySelectorAll(selectorString));

    return elements
      .filter(el => this._isVisible(el) && !this._isIgnored(el))
      .map(el => ({
        selector: this._getUniqueSelector(el),
        tag: el.tagName.toLowerCase(),
        type: el.type || null,
        label: this._getAccessibleLabel(el),
        isInteractive: true
      }));
  }

  _isVisible(el) {
    if (!el || el.offsetParent === null) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  _isIgnored(el) {
    for (const pattern of this.ignoredSelectors) {
      if (el.matches(pattern) || el.closest(pattern)) {
        return true;
      }
    }
    return false;
  }

  _getAccessibleLabel(el) {
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim();

    const placeholder = el.getAttribute('placeholder');
    if (placeholder) return placeholder.trim();

    if (el.id) {
      const labelEl = document.querySelector(`label[for="${el.id}"]`);
      if (labelEl) return labelEl.innerText.trim();
    }

    const text = el.innerText || el.value || '';
    return text.trim().slice(0, 50);
  }

  _getUniqueSelector(el) {
    if (el.id) return `#${el.id}`;
    if (el.getAttribute('data-agent-id')) return `[data-agent-id="${el.getAttribute('data-agent-id')}"]`;
    if (el.name) return `${el.tagName.toLowerCase()}[name="${el.name}"]`;

    // Fallback: build a short unique path
    const path = [];
    let current = el;
    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();
      if (current.className && typeof current.className === 'string') {
        const firstClass = current.className.trim().split(/\s+/)[0];
        if (firstClass) selector += `.${firstClass}`;
      }
      path.unshift(selector);
      current = current.parentElement;
      if (path.length >= 3) break;
    }
    return path.join(' > ');
  }
}
