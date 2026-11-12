/**
 * WebOrient Multi-Page Demo Shared Shell (v1.0.0 — Client Portal Session Telemetry, Drop-Off Funnel & Lead Rescue Edition)
 * - Exact DeployMate design.md visual language: Paper (#FFFFFF), Ink (#0A0A0A), Signal (#E6391E)
 * - Official DeployMate signature stacked SVG logo in header and footer
 * - Client Portal (`dashboard.html`): Live Credit Burn Ledger, Secretary VAD Savings, Section Drop-Off Funnel,
 *   DOM Action & Selector Execution Log, and Partial/Abandoned Lead Recovery Table
 */
import { WebOrient } from '../src/sdk/weborient.js';

const PAGES = [
  { id: 'home', file: 'test-demo.html', route: '/', label: 'Overview' },
  { id: 'features', file: 'features.html', route: '/features', label: 'Architecture' },
  { id: 'pricing', file: 'pricing.html', route: '/pricing', label: 'Pricing & ROI' },
  { id: 'docs', file: 'docs.html', route: '/docs', label: 'Developer Docs' },
  { id: 'contact', file: 'contact.html', route: '/contact', label: 'Enterprise' },
  { id: 'dashboard', file: 'dashboard.html', route: '/dashboard', label: 'Client Portal' }
];

export function initMultiPageDemo(pageConfig = {}) {
  const currentFile = window.location.pathname.split('/').pop() || 'test-demo.html';
  const activePage = PAGES.find(p => p.file === currentFile) || PAGES[0];

  injectDeployMateBaseStyles();
  mountGlobalHeader(activePage);
  mountGlobalFooter();
  mountMinimalAssistWidget(activePage);

  const weborient = new WebOrient({
    siteKey: 'wo_live_deploymate_demo',
    siteId: 'deploymate-weborient-showcase',
    themeColor: '#E6391E',
    accentColor: '#0A0A0A',
    cursorStyle: 'deploymate-signal',
    manifestUrl: '../config/sample-manifest.json',
    mountWidget: false,
    onEvent: (type, detail) => {
      if (type === 'status') {
        syncAssistUI(detail.status === 'connected' || detail.status === 'hibernating', detail.status === 'hibernating' ? 'hibernating' : 'idle');
      } else if (type === 'vadState') {
        if (detail.vadState === 'secretary_hold') syncAssistUI(true, 'secretary_hold');
        else if (detail.vadState === 'hibernating') syncAssistUI(true, 'hibernating');
        else syncAssistUI(true, 'listening');
      } else if (type === 'sessionRestored') {
        syncAssistUI(true, 'listening');
      } else if (type === 'transcript') {
        const state = detail.role === 'model' ? 'speaking' : 'listening';
        syncAssistUI(true, state);
      } else if (type === 'interrupted') {
        syncAssistUI(true, 'interrupted');
      }
    }
  });
  window.weborient = weborient;

  wireGenericTabs(weborient);
  wireGenericCarousels(weborient);
  wireAssistToggleActions(weborient, activePage);

  return weborient;
}

export function addPersistentLog(action, details) {
  try {
    const raw = localStorage.getItem('weborient_multipage_demo_logs_v5');
    const logs = raw ? JSON.parse(raw) : [];
    const pageName = window.location.pathname.split('/').pop() || 'home';
    logs.push({
      page: pageName.replace('.html', ''),
      action,
      details,
      time: new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
    });
    localStorage.setItem('weborient_multipage_demo_logs_v5', JSON.stringify(logs.slice(-40)));
  } catch (_) {}
  console.log(`[WebOrient Log] ${action}:`, details);
}

function injectDeployMateBaseStyles() {
  if (document.getElementById('deploymate-design-system-styles')) return;
  const style = document.createElement('style');
  style.id = 'deploymate-design-system-styles';
  style.textContent = `
    :root {
      --color-paper: #FFFFFF;
      --color-ink: #0A0A0A;
      --color-signal: #E6391E;
      --color-signal-deep: #C90C0F;
      --font-display: "Space Grotesk", -apple-system, BlinkMacSystemFont, sans-serif;
      --font-sans: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
      --font-mono: "Fira Code", ui-monospace, SFMono-Regular, monospace;
    }
    body {
      background-color: var(--color-paper);
      color: var(--color-ink);
      font-family: var(--font-sans);
      -webkit-font-smoothing: antialiased;
      overflow-x: hidden;
    }
    .font-display {
      font-family: var(--font-display);
      letter-spacing: -0.03em;
    }
    .font-mono {
      font-family: var(--font-mono);
    }
    .dm-grid-bg {
      background-size: 48px 48px;
      background-image:
        linear-gradient(to right, rgba(10, 10, 10, 0.04) 1px, transparent 1px),
        linear-gradient(to bottom, rgba(10, 10, 10, 0.04) 1px, transparent 1px);
    }
    .dm-row-hover {
      transition: background-color 0.25s ease, color 0.25s ease;
    }
    .dm-row-hover:hover {
      background-color: #0A0A0A;
      color: #FFFFFF;
    }
    .dm-row-hover:hover .dm-muted {
      color: rgba(255, 255, 255, 0.72) !important;
    }
    .dm-row-hover:hover .dm-badge {
      border-color: rgba(255, 255, 255, 0.35) !important;
      color: #FFFFFF !important;
    }
  `;
  document.head.appendChild(style);
}

function mountGlobalHeader(activePage) {
  const existing = document.getElementById('global-site-header');
  if (existing) existing.remove();

  const header = document.createElement('header');
  header.id = 'global-site-header';
  header.className = 'sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-[#0A0A0A]';

  const navItemsHtml = PAGES.map(p => {
    const isCurrent = p.id === activePage.id;
    return `
      <a href="${p.file}" id="nav-link-${p.id}" data-page-file="${p.file}" class="px-4 py-2 text-xs font-mono uppercase tracking-[0.12em] transition-colors ${
        isCurrent
          ? 'bg-[#0A0A0A] text-white font-medium'
          : 'text-[#0A0A0A]/75 hover:text-[#0A0A0A] hover:bg-[#0A0A0A]/5'
      }">
        <span>${p.label}</span>
      </a>
    `;
  }).join('');

  header.innerHTML = `
    <div class="max-w-7xl mx-auto px-6 md:px-12 h-20 flex items-center justify-between gap-4">
      <a href="test-demo.html" class="flex items-center gap-3.5 group" aria-label="DeployMate WebOrient Home">
        <img src="deploymate-stacked-logo.svg" alt="DeployMate" class="h-11 w-auto object-contain transition-transform duration-300 group-hover:scale-105" />
        <div class="border-l border-[#0A0A0A]/20 pl-3.5 hidden sm:block">
          <div class="font-display font-bold text-sm tracking-tight text-[#0A0A0A] flex items-center gap-2">
            <span>WEBORIENT</span>
            <span class="text-[9px] font-mono uppercase tracking-[0.18em] px-2 py-0.5 bg-[#E6391E] text-white">LIVE SDK</span>
          </div>
          <div class="text-[10px] font-mono uppercase tracking-[0.15em] text-[#0A0A0A]/55">DeployMate Voice Co-Pilot</div>
        </div>
      </a>

      <div class="flex items-center gap-2 sm:gap-6">
        <nav aria-label="Primary Multi-Page Navigation" class="flex items-center gap-1">
          ${navItemsHtml}
        </nav>
        <button id="header-btn-assist" type="button" class="hidden md:flex items-center gap-2 px-4 py-2 bg-[#0A0A0A] hover:bg-[#E6391E] text-white font-mono text-xs uppercase tracking-[0.14em] transition-colors border border-[#0A0A0A] cursor-pointer">
          <span class="w-2 h-2 rounded-full bg-[#E6391E]"></span>
          <span>Live Assist</span>
        </button>
      </div>
    </div>
  `;

  document.body.prepend(header);

  const headerAssistBtn = document.getElementById('header-btn-assist');
  if (headerAssistBtn) {
    headerAssistBtn.addEventListener('click', () => {
      const toggle = document.getElementById('btn-assist-toggle');
      if (toggle) toggle.click();
    });
  }
}

function mountGlobalFooter() {
  const existing = document.getElementById('global-site-footer');
  if (existing) existing.remove();

  const footer = document.createElement('footer');
  footer.id = 'global-site-footer';
  footer.className = 'border-t border-[#0A0A0A] bg-white text-[#0A0A0A] mt-20';
  footer.innerHTML = `
    <div class="max-w-7xl mx-auto px-6 md:px-12 py-12 flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
      <div class="flex items-center gap-4">
        <img src="deploymate-stacked-logo.svg" alt="DeployMate" class="h-10 w-auto object-contain" />
        <div class="text-xs text-[#0A0A0A]/65 max-w-sm">
          <div class="font-display font-bold text-[#0A0A0A] uppercase tracking-tight">DeployMate WebOrient Cloud</div>
          <div>Zero-Hijack Shadow DOM Co-Browsing &amp; Multimodal Voice Agent</div>
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-6 font-mono text-[11px] uppercase tracking-[0.15em] text-[#0A0A0A]/60">
        <a href="test-demo.html" class="hover:text-[#E6391E] transition-colors">Overview</a>
        <a href="features.html" class="hover:text-[#E6391E] transition-colors">Architecture</a>
        <a href="pricing.html" class="hover:text-[#E6391E] transition-colors">Pricing</a>
        <a href="docs.html" class="hover:text-[#E6391E] transition-colors">Docs</a>
        <a href="contact.html" class="hover:text-[#E6391E] transition-colors">Enterprise</a>
      </div>
    </div>
  `;
  document.body.appendChild(footer);
}

function mountMinimalAssistWidget(activePage) {
  const existing = document.getElementById('weborient-assist-widget');
  if (existing) existing.remove();

  const widget = document.createElement('div');
  widget.id = 'weborient-assist-widget';
  widget.setAttribute('data-agent-ignore', 'true');
  widget.className = 'fixed bottom-6 right-6 z-50 flex items-center select-none font-sans';

  widget.innerHTML = `
    <style>
      @keyframes siri-wave {
        0%, 100% { transform: scaleY(0.28); opacity: 0.65; }
        50% { transform: scaleY(1.0); opacity: 1; }
      }
      .siri-bar {
        width: 3px;
        height: 20px;
        border-radius: 999px;
        transform-origin: center;
        animation: siri-wave 1.05s ease-in-out infinite;
      }
      .siri-bar:nth-child(1) { animation-delay: 0.0s; background: #E6391E; }
      .siri-bar:nth-child(2) { animation-delay: 0.15s; background: #FF6B4A; height: 25px; }
      .siri-bar:nth-child(3) { animation-delay: 0.3s; background: #FFFFFF; height: 30px; }
      .siri-bar:nth-child(4) { animation-delay: 0.45s; background: #FF6B4A; height: 24px; }
      .siri-bar:nth-child(5) { animation-delay: 0.6s; background: #E6391E; height: 18px; }
    </style>

    <div id="assist-pill-container" class="relative group flex items-center">
      <button id="btn-assist-toggle" type="button" aria-label="Toggle WebOrient Voice Assist" class="flex items-center gap-3 px-4 py-2.5 rounded-full bg-[#0A0A0A] hover:bg-[#181818] border border-[#0A0A0A] text-white shadow-2xl transition-all duration-300 hover:scale-105 active:scale-95 cursor-pointer">
        <div id="assist-idle-icon" class="w-7 h-7 rounded-full bg-[#E6391E] flex items-center justify-center text-white shadow-sm">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
            <line x1="12" y1="19" x2="12" y2="22"></line>
          </svg>
        </div>

        <div id="assist-waveform" class="hidden items-center gap-1 h-6 px-1">
          <div class="siri-bar"></div>
          <div class="siri-bar"></div>
          <div class="siri-bar"></div>
          <div class="siri-bar"></div>
          <div class="siri-bar"></div>
        </div>

        <div class="flex flex-col text-left pr-1">
          <span id="assist-label" class="text-[11px] font-mono uppercase tracking-[0.14em] font-semibold text-white flex items-center gap-1.5">
            <span>WebOrient</span>
            <span id="assist-status-dot" class="w-1.5 h-1.5 rounded-full bg-[#E6391E]"></span>
          </span>
          <span id="assist-sublabel" class="text-[9px] font-mono uppercase tracking-[0.1em] text-white/60">Click to co-browse</span>
        </div>
      </button>

      <div id="assist-lang-popover" class="hidden absolute bottom-full right-0 mb-2 p-2.5 bg-[#0A0A0A] border border-white/20 shadow-2xl text-[11px] w-48 space-y-1.5">
        <div class="text-[9px] font-mono uppercase tracking-[0.18em] text-[#E6391E] px-1">Session Voice Language</div>
        <select id="quick-lang-select" class="w-full px-2 py-1.5 bg-white/10 border border-white/20 text-[11px] font-mono text-white focus:outline-none">
          <option value="en-IN" class="text-black">English (India/Global)</option>
          <option value="hinglish" class="text-black">Hinglish (Hindi + Eng)</option>
          <option value="hi-IN" class="text-black">Hindi (हिन्दी)</option>
          <option value="es-ES" class="text-black">Español (Spanish)</option>
          <option value="fr-FR" class="text-black">Français (French)</option>
        </select>
      </div>
    </div>
  `;

  document.body.appendChild(widget);
}

function wireAssistToggleActions(weborient, activePage) {
  const btnToggle = document.getElementById('btn-assist-toggle');
  const langSelect = document.getElementById('quick-lang-select');
  const langPopover = document.getElementById('assist-lang-popover');

  btnToggle.addEventListener('click', async (e) => {
    if (e.target.closest('#quick-lang-select')) return;

    if (!weborient.client || weborient.client.vadState === 'hibernating') {
      syncAssistUI(true, 'connecting');
      const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      weborient.options.endpoint = isLocal ? 'ws://localhost:8088' : 'wss://relay.deploymate.in';
      try {
        await weborient.start({ isRestore: Boolean(weborient.client) });
        syncAssistUI(true, 'listening');
      } catch (err) {
        console.warn('[WebOrient] Connection error:', err);
        syncAssistUI(false, 'offline');
      }
    } else {
      weborient.stop();
      syncAssistUI(false, 'idle');
    }
  });

  btnToggle.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    langPopover.classList.toggle('hidden');
  });

  if (langSelect) {
    langSelect.value = weborient.memory.state.userLanguage || 'en-IN';
    langSelect.addEventListener('change', (e) => {
      weborient.memory.setLanguage(e.target.value, true, 'manual dropdown selection');
      langPopover.classList.add('hidden');
    });
  }
}

function syncAssistUI(connected, state = 'idle') {
  const btn = document.getElementById('btn-assist-toggle');
  const idleIcon = document.getElementById('assist-idle-icon');
  const waveform = document.getElementById('assist-waveform');
  const sublabel = document.getElementById('assist-sublabel');
  const dot = document.getElementById('assist-status-dot');

  if (!btn || !waveform || !idleIcon) return;

  if (connected) {
    btn.className = 'flex items-center gap-3 px-4 py-2.5 rounded-full bg-[#0A0A0A] border-2 border-[#E6391E] text-white shadow-2xl transition-all duration-300 cursor-pointer';

    if (state === 'speaking') {
      idleIcon.classList.add('hidden');
      waveform.classList.remove('hidden');
      waveform.style.display = 'flex';
      sublabel.textContent = 'AI Co-Browsing...';
      dot.className = 'w-1.5 h-1.5 rounded-full bg-[#E6391E] animate-ping';
    } else if (state === 'secretary_hold') {
      idleIcon.classList.remove('hidden');
      waveform.classList.add('hidden');
      waveform.style.display = 'none';
      sublabel.textContent = 'Standby (0m burn · Speak)';
      dot.className = 'w-1.5 h-1.5 rounded-full bg-amber-400';
    } else if (state === 'hibernating') {
      idleIcon.classList.remove('hidden');
      waveform.classList.add('hidden');
      waveform.style.display = 'none';
      sublabel.textContent = 'Paused · Speak to wake';
      dot.className = 'w-1.5 h-1.5 rounded-full bg-amber-400';
    } else if (state === 'listening') {
      idleIcon.classList.add('hidden');
      waveform.classList.remove('hidden');
      waveform.style.display = 'flex';
      sublabel.textContent = 'Listening Live...';
      dot.className = 'w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse';
    } else {
      idleIcon.classList.add('hidden');
      waveform.classList.remove('hidden');
      waveform.style.display = 'flex';
      sublabel.textContent = 'Live Session';
      dot.className = 'w-1.5 h-1.5 rounded-full bg-[#E6391E]';
    }
  } else {
    idleIcon.classList.remove('hidden');
    waveform.classList.add('hidden');
    waveform.style.display = 'none';
    btn.className = 'flex items-center gap-3 px-4 py-2.5 rounded-full bg-[#0A0A0A] hover:bg-[#181818] border border-[#0A0A0A] text-white shadow-2xl transition-all duration-300 hover:scale-105 active:scale-95 cursor-pointer';

    if (state === 'offline') {
      sublabel.textContent = 'Relay offline';
      dot.className = 'w-1.5 h-1.5 rounded-full bg-amber-500';
    } else {
      sublabel.textContent = 'Click to co-browse';
      dot.className = 'w-1.5 h-1.5 rounded-full bg-[#E6391E]';
    }
  }
}

function wireGenericTabs(weborient) {
  document.querySelectorAll('[role="tablist"]').forEach(tablist => {
    const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => {
          t.setAttribute('aria-selected', 'false');
          t.classList.remove('active', 'bg-[#0A0A0A]', 'bg-[#E6391E]', 'text-white');
          t.classList.add('bg-white', 'text-[#0A0A0A]');
        });
        tab.setAttribute('aria-selected', 'true');
        tab.classList.add('active', 'bg-[#0A0A0A]', 'text-white');
        tab.classList.remove('bg-white', 'text-[#0A0A0A]');

        const targetPanelId = tab.getAttribute('data-target-panel');
        if (targetPanelId) {
          const group = tablist.getAttribute('data-tab-group');
          if (group) {
            document.querySelectorAll(`[data-panel-group="${group}"]`).forEach(p => {
              p.classList.toggle('hidden', p.id !== targetPanelId);
            });
          }
        }

        const parentSec = tablist.closest('section[id]');
        if (parentSec && weborient) {
          weborient.memory.markOriented({
            selector: `#${parentSec.id}`,
            title: `Interacted with ${tab.innerText.trim()}`
          });
        }
      });
    });
  });
}

function wireGenericCarousels(weborient) {
  document.querySelectorAll('[data-carousel]').forEach(carousel => {
    const slides = Array.from(carousel.querySelectorAll('[data-carousel-slide]'));
    if (slides.length === 0) return;
    let current = 0;

    const show = (idx) => {
      current = (idx + slides.length) % slides.length;
      slides.forEach((s, i) => s.classList.toggle('hidden', i !== current));
      const counter = carousel.parentElement?.querySelector('[data-carousel-counter]');
      if (counter) counter.innerText = `0${current + 1} / 0${slides.length}`;
      const parentSec = carousel.closest('section[id]');
      if (parentSec && weborient) {
        weborient.memory.markOriented({ selector: `#${parentSec.id}`, title: `Viewed carousel slide ${current + 1}` });
      }
    };

    const nextBtn = carousel.parentElement?.querySelector('[data-carousel-next]') || carousel.querySelector('[data-carousel-next]');
    const prevBtn = carousel.parentElement?.querySelector('[data-carousel-prev]') || carousel.querySelector('[data-carousel-prev]');
    if (nextBtn) nextBtn.addEventListener('click', () => show(current + 1));
    if (prevBtn) prevBtn.addEventListener('click', () => show(current - 1));
  });
}

/**
 * Wires the Customer Onboarding, Credit Burn Analytics, Section Drop-Off Funnel & Lead Rescue Portal (dashboard.html)
 */
export function initPortalDashboard(weborient) {
  const form = document.getElementById('tenant-register-form');
  if (!form) return;

  let activeSiteKey = 'wo_live_deploymate_demo';
  const codeEl = document.getElementById('generated-script-code');
  const templateBase = codeEl ? codeEl.textContent : '';

  function updateSnippetPreview(siteKey, domain, theme, lang, credits) {
    activeSiteKey = siteKey;
    if (codeEl && templateBase) {
      codeEl.textContent = templateBase
        .replace(/data-site-key="[^"]*"/, `data-site-key="${siteKey}"`)
        .replace(/data-theme="[^"]*"/, `data-theme="${theme}"`)
        .replace(/data-lang="[^"]*"/, `data-lang="${lang}"`);
    }
    const originLock = document.getElementById('preview-origin-lock');
    if (originLock) {
      originLock.textContent = domain ? `*.${domain}` : '*.myshop.com';
    }
    const badge = document.getElementById('wallet-key-badge');
    if (badge) badge.textContent = siteKey;
    const minsEl = document.getElementById('wallet-minutes-value');
    if (minsEl && credits !== undefined) {
      minsEl.textContent = Number(credits).toFixed(1);
    }
  }

  function callRelayPortalRpc(payload) {
    return new Promise((resolve) => {
      try {
        const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        const wsHost = isLocal ? 'localhost:8088' : 'relay.deploymate.in';
        const ws = new WebSocket(`${wsProto}//${wsHost}/?mode=portal`);
        const timer = setTimeout(() => { ws.close(); resolve(null); }, 6000);
        ws.onopen = () => ws.send(JSON.stringify(payload));
        ws.onmessage = (ev) => {
          clearTimeout(timer);
          try { resolve(JSON.parse(ev.data)); } catch (_) { resolve(null); }
          ws.close();
        };
        ws.onerror = () => { clearTimeout(timer); resolve(null); };
      } catch (_) {
        resolve(null);
      }
    });
  }

  /**
   * Escapes dynamic text before interpolating into HTML templates.
   * @param {*} value Raw value from tenant or session telemetry
   * @returns {string} HTML-safe escaped string
   */
  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Renders client session telemetry, drop-off funnel, and rescued leads safely.
   * @param {Array<Object>} sessions Recent visitor sessions
   */
  function renderClientSessionTelemetry(sessions = []) {
    let container = document.getElementById('client-session-telemetry-panel');
    if (!container) {
      const mainEl = document.querySelector('main');
      if (!mainEl) return;
      container = document.createElement('section');
      container.id = 'client-session-telemetry-panel';
      container.className = 'border border-[#0A0A0A] bg-white p-8 mt-12 space-y-6';
      mainEl.appendChild(container);
    }

    const totalBurned = sessions.reduce((acc, s) => acc + Number(s.creditsBurned || 0), 0);
    const totalSavedSec = sessions.reduce((acc, s) => acc + Number(s.secretarySavedSeconds || 0), 0);
    const partialLeads = sessions.filter(s => s.partialLead && (s.partialLead.email || s.partialLead.phone || s.partialLead.fullName));
    const dropOffCounts = {};
    for (const s of sessions) {
      const sec = s.lastSectionViewed || 'Hero / Overview';
      dropOffCounts[sec] = (dropOffCounts[sec] || 0) + 1;
    }
    const topDropOffs = Object.entries(dropOffCounts).sort((a, b) => b[1] - a[1]).slice(0, 4);

    container.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-4 border-b border-[#0A0A0A] pb-4">
        <div>
          <div class="text-[10px] font-mono uppercase tracking-[0.2em] text-[#E6391E]">04 // Visitor Session Analytics, Drop-Off Funnel &amp; Lead Rescue</div>
          <h2 class="font-display font-bold text-2xl mt-1">Credit Burn Ledger, Section Engagement &amp; Unconverted Leads</h2>
        </div>
        <span class="font-mono text-xs px-3 py-1.5 bg-[#0A0A0A] text-white">
          Burned: ${totalBurned.toFixed(1)}m · Secretary Auto-Hold Saved: ${totalSavedSec}s
        </span>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div class="border border-[#0A0A0A]/20 p-5 space-y-3">
          <div class="text-[10px] font-mono uppercase tracking-[0.18em] text-[#E6391E]">Where Visitors Back Off (Exit Section Funnel)</div>
          ${topDropOffs.length === 0 ? '<p class="text-xs text-[#0A0A0A]/50">No visitor drop-offs recorded yet.</p>' : topDropOffs.map(([sec, count]) => `
            <div class="flex items-center justify-between text-xs font-mono border-b border-[#0A0A0A]/10 pb-2">
              <span class="truncate pr-3">${escapeHtml(sec)}</span>
              <span class="font-bold text-[#E6391E]">${count} visitor${count > 1 ? 's' : ''}</span>
            </div>
          `).join('')}
        </div>

        <div class="border border-[#0A0A0A]/20 p-5 space-y-3">
          <div class="text-[10px] font-mono uppercase tracking-[0.18em] text-[#E6391E]">Rescued Partial &amp; Converted Leads (${partialLeads.length})</div>
          ${partialLeads.length === 0 ? '<p class="text-xs text-[#0A0A0A]/50">When a visitor speaks or types their phone/email (even if they leave before clicking Submit), their lead appears here.</p>' : partialLeads.slice(0, 5).map(s => `
            <div class="text-xs font-mono border-b border-[#0A0A0A]/10 pb-2">
              <div class="font-bold">${escapeHtml(s.partialLead.fullName || 'Visitor')} · ${escapeHtml(s.partialLead.email || s.partialLead.phone || '')}</div>
              <div class="text-[10px] text-[#0A0A0A]/60">Status: ${s.partialLead.submitted ? '✓ Submitted' : '⚡ Abandoned at ' + escapeHtml(s.lastSectionViewed || 'Form')}</div>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="space-y-3">
        <div class="text-[10px] font-mono uppercase tracking-[0.18em] text-[#0A0A0A]/60">Recent Visitor Sessions, DOM Actions &amp; Voice Transcripts (${sessions.length})</div>
        ${sessions.slice(0, 8).map(s => `
          <details class="border border-[#0A0A0A]/20 p-4 bg-[#0A0A0A]/[0.01]">
            <summary class="cursor-pointer font-mono text-xs flex flex-wrap items-center justify-between gap-2">
              <span><strong>${escapeHtml(s.sessionId)}</strong> (${escapeHtml(s.userLanguage || 'en-IN')}) · Last Section: ${escapeHtml(s.lastSectionViewed || 'Hero')}</span>
              <span>Burned: <strong>${Number(s.creditsBurned || 0).toFixed(1)}m</strong> · Saved: <strong>${Number(s.secretarySavedSeconds || 0)}s</strong> · DOM Actions: <strong>${(s.domEvents || []).length}</strong></span>
            </summary>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 pt-3 border-t border-[#0A0A0A]/15 text-xs font-mono">
              <div>
                <div class="text-[10px] uppercase text-[#E6391E] mb-2">DOM Highlights, Clicks, Swipes &amp; Scrolls</div>
                ${(s.domEvents || []).length === 0 ? '<div class="text-[#0A0A0A]/45">No DOM actions yet.</div>' : (s.domEvents || []).slice(-10).map(ev => `
                  <div class="py-1 border-b border-[#0A0A0A]/10">
                    <span>${ev.success ? '✓' : '✕'} <strong>${escapeHtml(ev.tool)}</strong> -> <code>${escapeHtml(ev.selector)}</code></span>
                    ${ev.error ? `<div class="text-[#E6391E]">${escapeHtml(ev.error)}</div>` : ''}
                  </div>
                `).join('')}
              </div>
              <div>
                <div class="text-[10px] uppercase text-[#E6391E] mb-2">Voice Conversation Transcript</div>
                ${(s.transcripts || []).length === 0 ? '<div class="text-[#0A0A0A]/45">No speech turns recorded.</div>' : (s.transcripts || []).slice(-8).map(t => `
                  <div class="py-1 border-b border-[#0A0A0A]/10">
                    <strong>${t.role === 'model' ? 'Kavya' : 'Visitor'}:</strong> ${escapeHtml(t.text)}
                  </div>
                `).join('')}
              </div>
            </div>
          </details>
        `).join('')}
      </div>
    `;
  }

  /**
   * Loads registered tenants from relay portal RPC (with local config fallback) and binds selection controls.
   */
  async function loadTenantsRegistry() {
    const tbody = document.getElementById('tenants-table-body');
    if (!tbody) return;
    let tenants = [];
    let sessions = [];

    const rpcRes = await callRelayPortalRpc({ tenantAction: 'list' });
    if (rpcRes && Array.isArray(rpcRes.tenants)) {
      tenants = rpcRes.tenants;
      sessions = rpcRes.sessions || [];
    } else {
      try {
        const fallback = await fetch('../config/tenants.json');
        if (fallback.ok) {
          const obj = await fallback.json();
          tenants = Object.values(obj);
        }
      } catch (_) {}
    }

    const localExtra = JSON.parse(localStorage.getItem('weborient_local_tenants_v1') || '[]');
    for (const lt of localExtra) {
      if (!tenants.some(t => t.siteKey === lt.siteKey)) tenants.unshift(lt);
    }

    renderClientSessionTelemetry(sessions);

    if (!tenants.length) return;

    const current = tenants.find(t => t.siteKey === activeSiteKey) || tenants[0];
    if (current) {
      const minsEl = document.getElementById('wallet-minutes-value');
      const badge = document.getElementById('wallet-key-badge');
      if (minsEl) minsEl.textContent = Number(current.creditsMinutes || 0).toFixed(1);
      if (badge) badge.textContent = current.siteKey;
    }

    tbody.innerHTML = tenants.map(t => `
      <tr class="hover:bg-[#0A0A0A]/5">
        <td class="py-3.5 px-5 font-display font-bold text-sm">${escapeHtml(t.companyName || t.siteId)}</td>
        <td class="py-3.5 px-5 font-mono text-[#E6391E] font-semibold">${escapeHtml(t.siteKey)}</td>
        <td class="py-3.5 px-5 font-mono text-[11px]">${escapeHtml((t.allowedOrigins || []).slice(0, 3).join(', '))}</td>
        <td class="py-3.5 px-5 font-mono">${escapeHtml(t.plan || 'Pro Co-Pilot')}</td>
        <td class="py-3.5 px-5 font-mono font-bold">${Number(t.creditsMinutes || 0).toFixed(1)} mins</td>
        <td class="py-3.5 px-5">
          <button type="button" data-select-key="${escapeHtml(t.siteKey)}" data-select-domain="${escapeHtml((t.allowedOrigins || [''])[0])}" data-select-credits="${Number(t.creditsMinutes || 0)}" class="px-3 py-1 bg-[#0A0A0A] hover:bg-[#E6391E] text-white font-mono text-[10px] uppercase tracking-wider transition cursor-pointer">
            Use Key
          </button>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-select-key]').forEach(btn => {
      btn.addEventListener('click', () => {
        updateSnippetPreview(
          btn.getAttribute('data-select-key'),
          btn.getAttribute('data-select-domain'),
          document.getElementById('reg-theme')?.value || 'signal',
          document.getElementById('reg-lang')?.value || 'en-IN',
          btn.getAttribute('data-select-credits')
        );
      });
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const company = document.getElementById('reg-company').value.trim();
    const domain = document.getElementById('reg-domain').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const planSelect = document.getElementById('reg-plan');
    const plan = planSelect.value;
    const credits = planSelect.options[planSelect.selectedIndex]?.getAttribute('data-credits') || '300';
    const theme = document.getElementById('reg-theme').value;
    const lang = document.getElementById('reg-lang').value;
    const statusBox = document.getElementById('reg-status-msg');

    let createdTenant = null;
    const rpcRes = await callRelayPortalRpc({
      tenantAction: 'register',
      companyName: company,
      domain,
      email,
      plan,
      theme,
      lang,
      credits: parseFloat(credits)
    });

    if (rpcRes && rpcRes.tenant) {
      createdTenant = rpcRes.tenant;
    } else {
      const randHex = Array.from({ length: 12 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
      createdTenant = {
        siteKey: `wo_live_${randHex}`,
        companyName: company,
        allowedOrigins: [domain, `www.${domain}`],
        plan,
        creditsMinutes: parseFloat(credits)
      };
      const saved = JSON.parse(localStorage.getItem('weborient_local_tenants_v1') || '[]');
      saved.unshift(createdTenant);
      localStorage.setItem('weborient_local_tenants_v1', JSON.stringify(saved.slice(0, 20)));
    }

    updateSnippetPreview(createdTenant.siteKey, domain, theme, lang, createdTenant.creditsMinutes);
    if (statusBox) {
      statusBox.textContent = `✓ Provisioned ${createdTenant.siteKey} for ${company} (${domain}) with ${createdTenant.creditsMinutes} voice minutes!`;
      statusBox.classList.remove('hidden');
    }

    await loadTenantsRegistry();
    if (weborient) {
      weborient.handleToolCall('move_and_highlight', {
        selector: '#generated-snippet-panel',
        explanation: `Ready! Copy your 1-line script for ${domain}`
      });
    }
  });

  async function handleTopUp(minutesToAdd) {
    const rpcRes = await callRelayPortalRpc({
      tenantAction: 'addCredits',
      siteKey: activeSiteKey,
      minutes: minutesToAdd,
      demoTopup: activeSiteKey === 'wo_live_deploymate_demo'
    });
    const minsEl = document.getElementById('wallet-minutes-value');
    if (rpcRes && rpcRes.tenant && minsEl) {
      minsEl.textContent = Number(rpcRes.tenant.creditsMinutes).toFixed(1);
      await loadTenantsRegistry();
      return;
    }
    if (minsEl) {
      const curr = parseFloat(minsEl.textContent || '250');
      minsEl.textContent = (curr + minutesToAdd).toFixed(1);
    }
  }

  document.getElementById('btn-topup-150')?.addEventListener('click', () => handleTopUp(150));
  document.getElementById('btn-topup-500')?.addEventListener('click', () => handleTopUp(500));
  document.getElementById('btn-refresh-tenants')?.addEventListener('click', loadTenantsRegistry);

  document.getElementById('btn-copy-script')?.addEventListener('click', (e) => {
    const code = document.getElementById('generated-script-code')?.textContent || '';
    navigator.clipboard.writeText(code);
    e.target.textContent = '✓ Copied to Clipboard!';
    setTimeout(() => { e.target.textContent = 'Copy Script Tag'; }, 2000);
  });

  document.getElementById('btn-test-cursor-portal')?.addEventListener('click', async () => {
    if (weborient) {
      await weborient.handleToolCall('guide_tour', {
        steps: [
          { selector: '#tenant-register-form', explanation: '1. Configure your domain & Shadow DOM theme', dwellMs: 1100 },
          { selector: '#generated-snippet-panel', explanation: '2. Copy your 1-line script tag', dwellMs: 1100 },
          { selector: '#wallet-balance-card', explanation: '3. Real-time credit metering wallet', dwellMs: 1100 }
        ]
      });
    }
  });

  loadTenantsRegistry();
}
