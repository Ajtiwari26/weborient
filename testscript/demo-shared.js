/**
 * WebOrient Multi-Page Demo Shared Shell & Control Bench (v0.2.0)
 * - Injects a unified sticky Multi-Page Navigation Header across all 5 demo pages
 * - Mounts the floating WebOrient Multi-Page Control Bench with Cross-Page Workflow triggers
 * - Persists the Closed-Loop Event Log across page navigations via sessionStorage
 * - Wires page-specific interactive widgets (tabs, carousels, switches, ROI calculators, forms)
 */
import { WebOrient } from '../src/sdk/weborient.js';

const LOG_STORAGE_KEY = 'weborient_multipage_demo_logs_v2';

const PAGES = [
  { id: 'home', file: 'test-demo.html', route: '/', label: 'Overview Hub', badge: 'Home' },
  { id: 'features', file: 'features.html', route: '/features', label: 'Architecture & Benchmarks', badge: '5 Layers' },
  { id: 'pricing', file: 'pricing.html', route: '/pricing', label: 'Pricing & ROI Calculator', badge: 'Interactive' },
  { id: 'docs', file: 'docs.html', route: '/docs', label: 'Developer Docs & API', badge: '10 Tools' },
  { id: 'contact', file: 'contact.html', route: '/contact', label: 'Enterprise Intake Form', badge: 'Voice Fill' }
];

export function initMultiPageDemo(pageConfig = {}) {
  const currentFile = window.location.pathname.split('/').pop() || 'test-demo.html';
  const activePage = PAGES.find(p => p.file === currentFile) || PAGES[0];

  // 1. Mount Sticky Multi-Page Top Navigation Header
  mountGlobalHeader(activePage, pageConfig.sectionLinks || []);

  // 2. Mount Floating Control Bench
  mountControlBench(activePage);

  // 3. Initialize WebOrient SDK
  const weborient = new WebOrient({
    themeColor: '#6366f1',
    accentColor: '#ec4899',
    cursorStyle: 'modern-glow',
    manifestUrl: '../config/sample-manifest.json',
    onEvent: (type, detail) => {
      if (type === 'toolCall') {
        addPersistentLog(detail.name, formatArgsSummary(detail.args));
      } else if (type === 'transcript') {
        addPersistentLog('Voice AI', detail.text);
      } else if (type === 'interrupted') {
        addPersistentLog('Barge-In', 'Audio & active tour interrupted by user');
      } else if (type === 'status') {
        syncLiveButtonState(detail.status === 'connected');
      }
    }
  });
  window.weborient = weborient;

  // 4. Wire Generic Tabs, Carousels, Switches & Control Bench Buttons
  wireGenericTabs();
  wireGenericCarousels();
  wireControlBenchActions(weborient, activePage, pageConfig);
  renderStoredLogs();

  return weborient;
}

function mountGlobalHeader(activePage, sectionLinks) {
  const header = document.createElement('header');
  header.id = 'global-site-header';
  header.className = 'sticky top-0 z-40 bg-slate-950/90 backdrop-blur-md border-b border-slate-800/80';

  const navItemsHtml = PAGES.map(p => {
    const isCurrent = p.id === activePage.id;
    return `
      <a href="${p.file}" id="nav-link-${p.id}" class="px-3.5 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-2 ${
        isCurrent
          ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/25'
          : 'text-slate-300 hover:text-white hover:bg-slate-800/70'
      }">
        <span>${p.label}</span>
        <span class="text-[10px] px-1.5 py-0.5 rounded-full ${
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
            <a href="${s.selector}" class="px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-indigo-600/30 text-slate-300 hover:text-indigo-200 border border-slate-700/60 transition">
              ${s.label}
            </a>
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
            <span class="text-[10px] font-mono px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-full">Multi-Page v0.2</span>
          </div>
          <div class="text-[10px] text-slate-400">Voice Co-Browsing &amp; Ghost Cursor Platform</div>
        </div>
      </a>
      <nav aria-label="Primary Multi-Page Navigation" class="flex flex-wrap items-center gap-1.5">
        ${navItemsHtml}
      </nav>
    </div>
    ${subNavHtml}
  `;

  document.body.prepend(header);
}

function mountControlBench(activePage) {
  const bench = document.createElement('aside');
  bench.id = 'test-toolbar';
  bench.setAttribute('data-agent-ignore', 'true');
  bench.className = 'fixed bottom-4 right-4 z-50 bg-slate-900/95 backdrop-blur-md border border-slate-700/80 p-4 rounded-2xl shadow-2xl max-w-sm w-full max-h-[88vh] overflow-y-auto';

  bench.innerHTML = `
    <div class="flex items-center justify-between mb-2">
      <div class="flex items-center gap-2">
        <span class="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
        <h3 class="font-bold text-xs tracking-wider text-white uppercase">WebOrient Co-Pilot Bench</h3>
      </div>
      <span class="text-[10px] text-indigo-300 font-mono bg-indigo-500/15 px-2 py-0.5 rounded-full border border-indigo-500/30">${activePage.file}</span>
    </div>

    <!-- Live Voice Connection -->
    <div class="mb-2">
      <button id="btn-toggle-live" class="w-full py-2 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white rounded-lg font-semibold text-xs transition flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20">
        <span class="w-2 h-2 rounded-full bg-red-400" id="live-indicator"></span>
        <span id="live-btn-text">Connect Live Voice (Gemini 3.8)</span>
      </button>
    </div>

    <!-- Text Command Input -->
    <div class="flex gap-1.5 mb-3">
      <input id="live-text-prompt" type="text" placeholder="Type command or route (e.g. /pricing)..." class="flex-1 px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500">
      <button id="btn-send-prompt" class="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold transition">
        Run
      </button>
    </div>

    <!-- Cross-Page Multi-Step Workflows -->
    <div class="mb-2.5">
      <div class="text-[10px] font-mono uppercase tracking-wider text-indigo-400 mb-1.5">Cross-Page Autonomous Workflows</div>
      <div class="grid grid-cols-2 gap-1.5 text-[11px]">
        <button id="btn-xpage-pricing" class="bg-indigo-950/90 hover:bg-indigo-900 border border-indigo-500/40 text-indigo-200 p-2 rounded-lg font-medium transition text-left">
          ↳ Go Pricing + Annual + Pro
        </button>
        <button id="btn-xpage-features" class="bg-indigo-950/90 hover:bg-indigo-900 border border-indigo-500/40 text-indigo-200 p-2 rounded-lg font-medium transition text-left">
          ↳ Go Architecture + Swipe
        </button>
        <button id="btn-xpage-docs" class="bg-indigo-950/90 hover:bg-indigo-900 border border-indigo-500/40 text-indigo-200 p-2 rounded-lg font-medium transition text-left">
          ↳ Go Docs + Next.js Tab
        </button>
        <button id="btn-xpage-contact" class="bg-indigo-950/90 hover:bg-indigo-900 border border-indigo-500/40 text-indigo-200 p-2 rounded-lg font-medium transition text-left">
          ↳ Go Contact + Fill 9 Fields
        </button>
      </div>
    </div>

    <!-- Current Page Local Actions -->
    <div class="mb-2">
      <div class="text-[10px] font-mono uppercase tracking-wider text-emerald-400 mb-1.5">Current Page Actions (${activePage.badge})</div>
      <div class="grid grid-cols-2 gap-1.5 text-[11px]">
        <button id="btn-local-highlight" class="bg-indigo-600 hover:bg-indigo-500 text-white p-1.5 rounded-lg font-medium transition">
          Highlight + Explain
        </button>
        <button id="btn-local-tour" class="bg-purple-600 hover:bg-purple-500 text-white p-1.5 rounded-lg font-medium transition">
          3-Stop Page Tour
        </button>
        <button id="btn-local-tab" class="bg-sky-600 hover:bg-sky-500 text-white p-1.5 rounded-lg font-medium transition">
          Swap Tab / View
        </button>
        <button id="btn-local-swipe" class="bg-amber-600 hover:bg-amber-500 text-white p-1.5 rounded-lg font-medium transition">
          Swipe / Toggle Widget
        </button>
        <button id="btn-local-qa" class="bg-slate-800 hover:bg-slate-700 text-slate-200 p-1.5 rounded-lg font-medium transition">
          Read Page Q&amp;A
        </button>
        <button id="btn-local-scan" class="bg-slate-800 hover:bg-slate-700 text-slate-200 p-1.5 rounded-lg font-medium transition">
          Scan Page DOM
        </button>
        <button id="btn-local-scroll-top" class="bg-slate-800 hover:bg-slate-700 text-slate-300 p-1.5 rounded-lg font-medium transition">
          Scroll Top
        </button>
        <button id="btn-local-scroll-bottom" class="bg-slate-800 hover:bg-slate-700 text-slate-300 p-1.5 rounded-lg font-medium transition">
          Scroll Bottom
        </button>
      </div>
    </div>

    <!-- Persistent Cross-Page Console Log -->
    <div class="mt-2.5 pt-2 border-t border-slate-800">
      <div class="text-[10px] font-mono text-slate-400 mb-1 flex justify-between items-center">
        <span>Cross-Page Event Trail</span>
        <div class="flex items-center gap-2">
          <span id="log-count">0 events</span>
          <button id="btn-clear-logs" class="text-[10px] text-slate-500 hover:text-slate-300 underline">Clear</button>
        </div>
      </div>
      <div id="action-log" class="bg-black/70 p-2 rounded-lg text-[10px] font-mono text-emerald-400 h-24 overflow-y-auto space-y-1"></div>
    </div>
  `;

  document.body.appendChild(bench);
}

function wireControlBenchActions(weborient, activePage, pageConfig) {
  let isLiveConnected = false;
  const btnToggleLive = document.getElementById('btn-toggle-live');

  btnToggleLive.addEventListener('click', async () => {
    if (!isLiveConnected) {
      document.getElementById('live-btn-text').innerText = 'Connecting to Gemini 3.8...';
      weborient.options.endpoint = 'ws://localhost:8088';
      try {
        await weborient.start();
        isLiveConnected = true;
        syncLiveButtonState(true);
        addPersistentLog('Live Audio', `Connected on ${activePage.file}`);
      } catch (err) {
        document.getElementById('live-btn-text').innerText = 'Connection Failed (Run Relay)';
        addPersistentLog('Error', err.message);
      }
    } else {
      weborient.stop();
      isLiveConnected = false;
      syncLiveButtonState(false);
      addPersistentLog('Live Audio', 'Disconnected');
    }
  });

  // Text prompt / quick command runner (works both offline for route/tool commands and online with Live API)
  const promptInput = document.getElementById('live-text-prompt');
  const runPromptCommand = async () => {
    const val = promptInput.value.trim();
    if (!val) return;
    promptInput.value = '';

    if (weborient.sendTextPrompt(val)) {
      addPersistentLog('Prompt -> AI', val);
      return;
    }

    // Local smart intent fallback when testing without the Python relay running
    const lower = val.toLowerCase();
    if (lower.includes('pricing') || lower === '/pricing') {
      await weborient.handleToolCall('navigate_route', { path: '/pricing' });
    } else if (lower.includes('feature') || lower.includes('arch') || lower === '/features') {
      await weborient.handleToolCall('navigate_route', { path: '/features' });
    } else if (lower.includes('doc') || lower.includes('api') || lower === '/docs') {
      await weborient.handleToolCall('navigate_route', { path: '/docs' });
    } else if (lower.includes('contact') || lower.includes('form') || lower === '/contact') {
      await weborient.handleToolCall('navigate_route', { path: '/contact' });
    } else if (lower.includes('home') || lower === '/') {
      await weborient.handleToolCall('navigate_route', { path: '/' });
    } else if (lower.includes('tour')) {
      document.getElementById('btn-local-tour').click();
    } else {
      const res = await weborient.handleToolCall('read_page_content', { query: val });
      const matched = res.matchingSections?.[0];
      if (matched) {
        await weborient.handleToolCall('move_and_highlight', {
          selector: matched.selector,
          explanation: `${matched.heading}: ${matched.summary.slice(0, 90)}...`
        });
      }
    }
  };

  document.getElementById('btn-send-prompt').addEventListener('click', runPromptCommand);
  promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runPromptCommand();
  });

  // Cross-Page Multi-Step Workflows
  document.getElementById('btn-xpage-pricing').addEventListener('click', async () => {
    addPersistentLog('Workflow', 'Navigating to Pricing -> Toggle Annual -> Highlight Pro');
    const postActions = [
      { name: 'swipe_or_swap', args: { selector: '#billing-toggle', action: 'toggle' } },
      { name: 'move_and_highlight', args: { selector: '#plan-pro', explanation: 'Pro Co-Pilot with 20% Annual Discount Applied ($64/mo)' } }
    ];
    if (activePage.id === 'pricing') {
      for (const act of postActions) await weborient.handleToolCall(act.name, act.args);
    } else {
      weborient.queuePostNavigationActions(postActions);
      await weborient.handleToolCall('navigate_route', { path: 'pricing.html' });
    }
  });

  document.getElementById('btn-xpage-features').addEventListener('click', async () => {
    addPersistentLog('Workflow', 'Navigating to Architecture -> Swap Subsystem Tab -> Swipe Industry Slide');
    const postActions = [
      { name: 'swipe_or_swap', args: { selector: '#subsystem-tabs', action: 'select', targetValue: 'bezier' } },
      { name: 'swipe_or_swap', args: { selector: '#industry-carousel', action: 'next' } },
      { name: 'move_and_highlight', args: { selector: '#benchmark-table', explanation: 'Sub-350ms Voice-to-Action Latency vs Legacy Agents' } }
    ];
    if (activePage.id === 'features') {
      for (const act of postActions) await weborient.handleToolCall(act.name, act.args);
    } else {
      weborient.queuePostNavigationActions(postActions);
      await weborient.handleToolCall('navigate_route', { path: 'features.html' });
    }
  });

  document.getElementById('btn-xpage-docs').addEventListener('click', async () => {
    addPersistentLog('Workflow', 'Navigating to Docs -> Select Next.js Snippet -> Highlight Tools Spec');
    const postActions = [
      { name: 'swipe_or_swap', args: { selector: '#docs-framework-tabs', action: 'select', targetValue: 'nextjs' } },
      { name: 'move_and_highlight', args: { selector: '#tools-reference-section', explanation: '10 Built-in Gemini Live API Tool Declarations' } }
    ];
    if (activePage.id === 'docs') {
      for (const act of postActions) await weborient.handleToolCall(act.name, act.args);
    } else {
      weborient.queuePostNavigationActions(postActions);
      await weborient.handleToolCall('navigate_route', { path: 'docs.html' });
    }
  });

  document.getElementById('btn-xpage-contact').addEventListener('click', async () => {
    addPersistentLog('Workflow', 'Navigating to Enterprise Contact -> Batch Filling 9 Controls');
    const postActions = [
      {
        name: 'fill_form_batch',
        args: {
          fields: [
            { selector: '#contact-name', value: 'Ajay Tiwari' },
            { selector: '#contact-email', value: 'ajay at deploymate dot in' },
            { selector: '#contact-phone', value: '+91 98765 43210' },
            { selector: '#contact-company', value: 'DeployMate AI Labs' },
            { selector: '#contact-website', value: 'https://deploymate.in' },
            { selector: '#contact-framework', value: 'Next.js / React' },
            { selector: '#contact-plan', value: 'Pro Co-Pilot' },
            { selector: '#contact-team-size', value: '65' },
            { selector: '#contact-priority', value: 'true' },
            { selector: '#contact-hipaa', value: 'true' },
            { selector: '#contact-message', value: 'Deploying multi-page voice co-browsing across our customer onboarding and checkout flows.' }
          ]
        }
      },
      {
        name: 'move_and_highlight',
        args: {
          selector: '#btn-submit-contact',
          explanation: 'All 11 Enterprise fields validated! Ready to submit.'
        }
      }
    ];
    if (activePage.id === 'contact') {
      for (const act of postActions) await weborient.handleToolCall(act.name, act.args);
    } else {
      weborient.queuePostNavigationActions(postActions);
      await weborient.handleToolCall('navigate_route', { path: 'contact.html' });
    }
  });

  // Page-Local Action Buttons
  document.getElementById('btn-local-highlight').addEventListener('click', async () => {
    const target = pageConfig.highlightTarget || { selector: 'h1', explanation: `Active Page: ${document.title}` };
    await weborient.handleToolCall('move_and_highlight', target);
  });

  document.getElementById('btn-local-tour').addEventListener('click', async () => {
    const steps = pageConfig.tourSteps || [
      { selector: 'h1', explanation: '1. Page Headline & Context', dwellMs: 900 },
      { selector: 'section:nth-of-type(2)', explanation: '2. Primary Interactive Module', dwellMs: 900 },
      { selector: '#global-site-header nav', explanation: '3. Multi-Page Navigation Header', dwellMs: 900 }
    ];
    await weborient.handleToolCall('guide_tour', { steps });
  });

  document.getElementById('btn-local-tab').addEventListener('click', async () => {
    const tabSelector = pageConfig.tabSelector || '[role="tablist"]';
    await weborient.handleToolCall('swipe_or_swap', { selector: tabSelector, action: 'next' });
  });

  document.getElementById('btn-local-swipe').addEventListener('click', async () => {
    if (typeof pageConfig.onCustomSwipe === 'function') {
      await pageConfig.onCustomSwipe(weborient);
      return;
    }
    const swipeTarget = pageConfig.swipeSelector || '[data-carousel], [role="switch"], input[type="range"]';
    const el = document.querySelector(swipeTarget);
    const action = el?.getAttribute('role') === 'switch' ? 'toggle' : 'next';
    await weborient.handleToolCall('swipe_or_swap', { selector: swipeTarget, action });
  });

  document.getElementById('btn-local-qa').addEventListener('click', async () => {
    const qaTarget = pageConfig.qaTarget || { query: 'security' };
    const res = await weborient.handleToolCall('read_page_content', qaTarget);
    const preview = res.text || res.matchingSections?.[0]?.summary || 'Extracted page knowledge';
    addPersistentLog('Q&A Grounding', preview.slice(0, 75) + '...');
  });

  document.getElementById('btn-local-scan').addEventListener('click', async () => {
    const res = await weborient.handleToolCall('scan_visible_elements', { includeOffscreen: true });
    addPersistentLog('DOM Scanner', `Indexed ${res.elements.length} controls on ${activePage.file}`);
    console.table(res.elements);
  });

  document.getElementById('btn-local-scroll-top').addEventListener('click', async () => {
    await weborient.handleToolCall('scroll_page', { direction: 'top' });
  });

  document.getElementById('btn-local-scroll-bottom').addEventListener('click', async () => {
    await weborient.handleToolCall('scroll_page', { direction: 'bottom' });
  });

  document.getElementById('btn-clear-logs').addEventListener('click', () => {
    sessionStorage.removeItem(LOG_STORAGE_KEY);
    renderStoredLogs();
  });
}

function wireGenericTabs() {
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
      });
    });
  });
}

function wireGenericCarousels() {
  document.querySelectorAll('[data-carousel]').forEach(carousel => {
    const slides = Array.from(carousel.querySelectorAll('[data-carousel-slide]'));
    if (slides.length === 0) return;
    let current = 0;

    const show = (idx) => {
      current = (idx + slides.length) % slides.length;
      slides.forEach((s, i) => s.classList.toggle('hidden', i !== current));
      const counter = carousel.parentElement?.querySelector('[data-carousel-counter]');
      if (counter) counter.innerText = `Slide ${current + 1} of ${slides.length}`;
    };

    const nextBtn = carousel.parentElement?.querySelector('[data-carousel-next]') || carousel.querySelector('[data-carousel-next]');
    const prevBtn = carousel.parentElement?.querySelector('[data-carousel-prev]') || carousel.querySelector('[data-carousel-prev]');
    if (nextBtn) nextBtn.addEventListener('click', () => show(current + 1));
    if (prevBtn) prevBtn.addEventListener('click', () => show(current - 1));
  });
}

function syncLiveButtonState(connected) {
  const liveIndicator = document.getElementById('live-indicator');
  const liveBtnText = document.getElementById('live-btn-text');
  if (!liveIndicator || !liveBtnText) return;
  if (connected) {
    liveIndicator.className = 'w-2 h-2 rounded-full bg-emerald-400 animate-ping';
    liveBtnText.innerText = 'Listening (Speak or Type Command)';
  } else {
    liveIndicator.className = 'w-2 h-2 rounded-full bg-red-400';
    liveBtnText.innerText = 'Connect Live Voice (Gemini 3.8)';
  }
}

function formatArgsSummary(args = {}) {
  if (!args) return '';
  if (args.selector && args.value !== undefined) return `${args.selector} = "${args.value}"`;
  if (args.selector && args.action) return `${args.selector} (${args.action})`;
  if (args.selector) return `${args.selector}${args.explanation ? ` • ${args.explanation.slice(0, 35)}` : ''}`;
  if (args.path) return `-> ${args.path}`;
  if (Array.isArray(args.fields)) return `${args.fields.length} fields`;
  if (Array.isArray(args.steps)) return `${args.steps.length} tour stops`;
  return JSON.stringify(args).slice(0, 50);
}

export function addPersistentLog(action, details) {
  try {
    const raw = sessionStorage.getItem(LOG_STORAGE_KEY);
    const logs = raw ? JSON.parse(raw) : [];
    const pageName = window.location.pathname.split('/').pop() || 'home';
    logs.push({
      page: pageName.replace('.html', ''),
      action,
      details,
      time: new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
    });
    const trimmed = logs.slice(-40);
    sessionStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(trimmed));
  } catch (_) {}
  renderStoredLogs();
}

function renderStoredLogs() {
  const logBox = document.getElementById('action-log');
  const logCountEl = document.getElementById('log-count');
  if (!logBox || !logCountEl) return;

  let logs = [];
  try {
    const raw = sessionStorage.getItem(LOG_STORAGE_KEY);
    logs = raw ? JSON.parse(raw) : [];
  } catch (_) {}

  logCountEl.innerText = `${logs.length} events`;
  if (logs.length === 0) {
    logBox.innerHTML = `<div class="text-slate-500">Ready! Click any workflow or page action...</div>`;
    return;
  }

  logBox.innerHTML = logs.map(item => `
    <div class="leading-tight">
      <span class="text-slate-500">[${item.page}]</span>
      <span class="text-pink-400 font-semibold">${item.action}:</span>
      <span class="text-emerald-300">${item.details}</span>
    </div>
  `).join('');
  logBox.scrollTop = logBox.scrollHeight;
}
