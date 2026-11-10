/**
 * WebOrient Multi-Page Demo Shared Shell (v0.5.0 — Minimal Siri-Like Waveform & Assist Toggle)
 * - Zero site hijacking: Completely removes the big right-side panel and debug action logs.
 * - Minimal Assist Toggle: Sleek floating glassmorphic pill button in the bottom corner.
 * - Dynamic Siri-Like Waveform: Smooth organic soundwave animation that lights up and pulses
 *   when listening to user speech or when the Gemini Live model is speaking.
 * - Pure Co-Browsing: Only the Assist Toggle, Siri Waveform, and Ghost Cursor ever touch the site.
 */
import { WebOrient } from '../src/sdk/weborient.js';

const PAGES = [
  { id: 'home', file: 'test-demo.html', route: '/', label: 'Overview Hub', badge: 'Home' },
  { id: 'features', file: 'features.html', route: '/features', label: 'Architecture & Benchmarks', badge: '5 Layers' },
  { id: 'pricing', file: 'pricing.html', route: '/pricing', label: 'Pricing & ROI Calculator', badge: 'Interactive' },
  { id: 'docs', file: 'docs.html', route: '/docs', label: 'Developer Docs & API', badge: '11 Tools' },
  { id: 'contact', file: 'contact.html', route: '/contact', label: 'Enterprise Intake Form', badge: 'Voice Fill' }
];

export function initMultiPageDemo(pageConfig = {}) {
  const currentFile = window.location.pathname.split('/').pop() || 'test-demo.html';
  const activePage = PAGES.find(p => p.file === currentFile) || PAGES[0];

  // 1. Mount Clean Multi-Page Top Navigation Header
  mountGlobalHeader(activePage, pageConfig.sectionLinks || []);

  // 2. Mount Minimal Siri-Like Waveform & Assist Toggle
  mountMinimalAssistWidget(activePage);

  // 3. Initialize WebOrient SDK
  const weborient = new WebOrient({
    themeColor: '#6366f1',
    accentColor: '#ec4899',
    cursorStyle: 'modern-glow',
    manifestUrl: '../config/sample-manifest.json',
    onEvent: (type, detail) => {
      if (type === 'status') {
        syncAssistUI(detail.status === 'connected', 'idle');
      } else if (type === 'sessionRestored') {
        syncAssistUI(true, 'listening');
      } else if (type === 'transcript') {
        const state = detail.role === 'model' ? 'speaking' : 'listening';
        syncAssistUI(true, state);
      } else if (type === 'interrupted') {
        syncAssistUI(true, 'interrupted');
      } else if (type === 'memoryUpdate') {
        updateHeaderVisitedBadges(detail);
      }
    }
  });
  window.weborient = weborient;

  // 4. Wire Interactive Page Widgets
  wireGenericTabs(weborient);
  wireGenericCarousels(weborient);
  wireAssistToggleActions(weborient, activePage);
  updateHeaderVisitedBadges(weborient.memory.getState());

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

function mountGlobalHeader(activePage, sectionLinks) {
  const header = document.createElement('header');
  header.id = 'global-site-header';
  header.className = 'sticky top-0 z-40 bg-slate-950/90 backdrop-blur-md border-b border-slate-800/80';

  const navItemsHtml = PAGES.map(p => {
    const isCurrent = p.id === activePage.id;
    return `
      <a href="${p.file}" id="nav-link-${p.id}" data-page-file="${p.file}" class="px-3.5 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-2 ${
        isCurrent
          ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/25'
          : 'text-slate-300 hover:text-white hover:bg-slate-800/70'
      }">
        <span>${p.label}</span>
        <span data-visit-badge="${p.file}" class="text-[10px] px-1.5 py-0.5 rounded-full ${
          isCurrent ? 'bg-indigo-800 text-indigo-100' : 'bg-slate-800 text-slate-400'
        }">${p.badge}</span>
      </a>
    `;
  }).join('');

  const subNavHtml = sectionLinks.length > 0
    ? `
      <div class="bg-slate-900/70 border-t border-slate-800/60 px-6 py-2">
        <div class="max-w-6xl mx-auto flex flex-wrap items-center gap-2 text-[11px]">
          <span class="text-slate-400 font-mono uppercase tracking-wider mr-1">On this page (${activePage.file}):</span>
          ${sectionLinks.map(s => `
            <button type="button" data-section-target="${s.selector}" class="px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-indigo-600 hover:text-white text-slate-300 border border-slate-700/60 transition cursor-pointer flex items-center gap-1.5 active:scale-95">
              <span>${s.label}</span>
              <span class="text-[9px] text-indigo-400 font-mono">📍</span>
            </button>
          `).join('')}
        </div>
      </div>
    `
    : '';

  header.innerHTML = `
    <div class="max-w-6xl mx-auto px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
      <a href="test-demo.html" class="flex items-center gap-2.5 group">
        <div class="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-pink-500 flex items-center justify-center font-black text-white text-sm shadow-md">
          W
        </div>
        <div>
          <div class="font-extrabold text-sm tracking-tight text-white flex items-center gap-2">
            <span>Acme WebOrient</span>
            <span class="text-[10px] font-mono px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-full">v0.5 Minimal</span>
          </div>
          <div class="text-[10px] text-slate-400">Non-Intrusive Voice Co-Browsing SDK</div>
        </div>
      </a>
      <nav aria-label="Primary Multi-Page Navigation" class="flex flex-wrap items-center gap-1.5">
        ${navItemsHtml}
      </nav>
    </div>
    ${subNavHtml}
  `;

  document.body.prepend(header);

  header.querySelectorAll('[data-section-target]').forEach(btn => {
    btn.addEventListener('click', () => {
      const sel = btn.getAttribute('data-section-target');
      const label = btn.textContent.trim().replace('📍', '').trim();
      if (window.weborient) {
        window.weborient.handleToolCall('move_and_highlight', {
          selector: sel,
          explanation: label
        });
      }
    });
  });
}

function updateHeaderVisitedBadges(memState) {
  if (!memState || !Array.isArray(memState.todoChecklist)) return;
  for (const page of PAGES) {
    const pageTodos = memState.todoChecklist.filter(t => t.page === page.file);
    const doneCount = pageTodos.filter(t => t.done).length;
    const badge = document.querySelector(`[data-visit-badge="${page.file}"]`);
    if (badge && pageTodos.length > 0) {
      badge.textContent = `${doneCount}/${pageTodos.length} ✓`;
    }
  }
}

/**
 * Injects the minimal Siri-like Waveform & Assist Toggle.
 * Replaces the giant right-side panel with a discrete floating pill (~50px)
 * that expands into an organic Siri audio waveform when active.
 */
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
        0%, 100% { transform: scaleY(0.3); opacity: 0.6; }
        50% { transform: scaleY(1.0); opacity: 1; }
      }
      .siri-bar {
        width: 3.5px;
        height: 22px;
        border-radius: 999px;
        transform-origin: center;
        animation: siri-wave 1.1s ease-in-out infinite;
      }
      .siri-bar:nth-child(1) { animation-delay: 0.0s; background: #6366f1; }
      .siri-bar:nth-child(2) { animation-delay: 0.15s; background: #a855f7; height: 26px; }
      .siri-bar:nth-child(3) { animation-delay: 0.3s; background: #ec4899; height: 32px; }
      .siri-bar:nth-child(4) { animation-delay: 0.45s; background: #38bdf8; height: 28px; }
      .siri-bar:nth-child(5) { animation-delay: 0.6s; background: #34d399; height: 20px; }
    </style>

    <div id="assist-pill-container" class="relative group flex items-center">
      <!-- Minimal Assist Floating Button / Active Waveform Capsule -->
      <button id="btn-assist-toggle" type="button" aria-label="Toggle WebOrient Voice Assist" class="flex items-center gap-2.5 px-4 py-2.5 rounded-full bg-slate-900/95 hover:bg-slate-800/95 border border-slate-700/80 text-white shadow-2xl backdrop-blur-xl transition-all duration-300 hover:scale-105 active:scale-95 shadow-indigo-500/10">
        <!-- Inactive Mic Icon -->
        <div id="assist-idle-icon" class="w-6 h-6 rounded-full bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center text-indigo-300">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
            <line x1="12" y1="19" x2="12" y2="22"></line>
          </svg>
        </div>

        <!-- Siri Waveform Animation (Hidden when Idle) -->
        <div id="assist-waveform" class="hidden items-center gap-1 h-6 px-1">
          <div class="siri-bar"></div>
          <div class="siri-bar"></div>
          <div class="siri-bar"></div>
          <div class="siri-bar"></div>
          <div class="siri-bar"></div>
        </div>

        <!-- Label / State -->
        <div class="flex flex-col text-left">
          <span id="assist-label" class="text-xs font-bold tracking-tight text-white flex items-center gap-1.5">
            <span>Assist</span>
            <span id="assist-status-dot" class="w-1.5 h-1.5 rounded-full bg-slate-500"></span>
          </span>
          <span id="assist-sublabel" class="text-[9px] text-slate-400 font-medium">Click to talk</span>
        </div>
      </button>

      <!-- Language selector dropdown (discreet popover on hover/click) -->
      <div id="assist-lang-popover" class="hidden absolute bottom-full right-0 mb-2 p-2 bg-slate-900/95 border border-slate-800 rounded-xl shadow-xl backdrop-blur-md text-[11px] w-44 space-y-1">
        <div class="text-[9px] font-mono uppercase text-slate-400 px-1.5 pt-0.5">Voice Language</div>
        <select id="quick-lang-select" class="w-full px-2 py-1 bg-slate-950 border border-slate-700 rounded text-[11px] text-white focus:outline-none">
          <option value="en-IN">English (India/Global)</option>
          <option value="hinglish">Hinglish (Hindi + Eng)</option>
          <option value="hi-IN">Hindi (हिन्दी)</option>
          <option value="es-ES">Español (Spanish)</option>
          <option value="fr-FR">Français (French)</option>
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
    // If clicking right edge, toggle language popover
    if (e.target.closest('#quick-lang-select')) return;

    if (!weborient.client) {
      syncAssistUI(true, 'connecting');
      weborient.options.endpoint = 'ws://localhost:8088';
      try {
        await weborient.start();
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

  // Long press / right-click or secondary click opens language popover
  btnToggle.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    langPopover.classList.toggle('hidden');
  });

  if (langSelect) {
    langSelect.value = weborient.memory.state.userLanguage || 'en-IN';
    langSelect.addEventListener('change', (e) => {
      weborient.memory.setLanguage(e.target.value, true);
      if (weborient.client) {
        weborient.client.sendText(`[LANGUAGE CHANGE]: User set native language to ${e.target.value}. Respond in this language.`);
      }
      langPopover.classList.add('hidden');
    });
  }
}

function syncAssistUI(connected, state = 'idle') {
  const btn = document.getElementById('btn-assist-toggle');
  const idleIcon = document.getElementById('assist-idle-icon');
  const waveform = document.getElementById('assist-waveform');
  const label = document.getElementById('assist-label');
  const sublabel = document.getElementById('assist-sublabel');
  const dot = document.getElementById('assist-status-dot');

  if (!btn || !waveform || !idleIcon) return;

  if (connected) {
    idleIcon.classList.add('hidden');
    waveform.classList.remove('hidden');
    waveform.style.display = 'flex';
    btn.className = 'flex items-center gap-3 px-4 py-2.5 rounded-full bg-slate-900/95 hover:bg-slate-800/95 border border-indigo-500/60 text-white shadow-2xl backdrop-blur-xl transition-all duration-300 ring-2 ring-indigo-500/30';

    if (state === 'speaking') {
      sublabel.textContent = 'Speaking...';
      dot.className = 'w-1.5 h-1.5 rounded-full bg-pink-400 animate-pulse';
    } else if (state === 'listening') {
      sublabel.textContent = 'Listening...';
      dot.className = 'w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse';
    } else {
      sublabel.textContent = 'Live Session';
      dot.className = 'w-1.5 h-1.5 rounded-full bg-indigo-400';
    }
  } else {
    idleIcon.classList.remove('hidden');
    waveform.classList.add('hidden');
    waveform.style.display = 'none';
    btn.className = 'flex items-center gap-2.5 px-4 py-2.5 rounded-full bg-slate-900/95 hover:bg-slate-800/95 border border-slate-700/80 text-white shadow-2xl backdrop-blur-xl transition-all duration-300 hover:scale-105 active:scale-95';

    if (state === 'offline') {
      sublabel.textContent = 'Relay offline';
      dot.className = 'w-1.5 h-1.5 rounded-full bg-amber-500';
    } else {
      sublabel.textContent = 'Click to talk';
      dot.className = 'w-1.5 h-1.5 rounded-full bg-slate-500';
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
          t.classList.remove('active', 'bg-indigo-600', 'text-white');
          t.classList.add('text-slate-400');
        });
        tab.setAttribute('aria-selected', 'true');
        tab.classList.add('active', 'bg-indigo-600', 'text-white');
        tab.classList.remove('text-slate-400');

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
      if (counter) counter.innerText = `Slide ${current + 1} of ${slides.length}`;
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
