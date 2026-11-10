/**
 * WebOrient Multi-Page Demo Shared Shell, Session Memory Inspector & Salesperson Bench (v0.3.0)
 * - Injects unified sticky Multi-Page Navigation Header with "Oriented ✓" badges on visited pages
 * - Mounts the floating WebOrient Co-Pilot & Salesperson Bench featuring:
 *   1. "▶ Start Synchronized Multi-Page Salesperson Pitch" (Show & Describe Simultaneously)
 *   2. Native Language Selector (English, Hinglish, Hindi, Español) persisted across pages
 *   3. User Goal / Want input persisted across pages
 *   4. Live "Already Oriented" vs "What Else to Describe" Session Memory tracker
 * - Persists the Closed-Loop Event Log across page navigations via sessionStorage
 */
import { WebOrient } from '../src/sdk/weborient.js';

const LOG_STORAGE_KEY = 'weborient_multipage_demo_logs_v2';

const PAGES = [
  { id: 'home', file: 'test-demo.html', route: '/', label: 'Overview Hub', badge: 'Home' },
  { id: 'features', file: 'features.html', route: '/features', label: 'Architecture & Benchmarks', badge: '5 Layers' },
  { id: 'pricing', file: 'pricing.html', route: '/pricing', label: 'Pricing & ROI Calculator', badge: 'Interactive' },
  { id: 'docs', file: 'docs.html', route: '/docs', label: 'Developer Docs & API', badge: '12 Tools' },
  { id: 'contact', file: 'contact.html', route: '/contact', label: 'Enterprise Intake Form', badge: 'Voice Fill' }
];

export function initMultiPageDemo(pageConfig = {}) {
  const currentFile = window.location.pathname.split('/').pop() || 'test-demo.html';
  const activePage = PAGES.find(p => p.file === currentFile) || PAGES[0];

  // 1. Mount Sticky Multi-Page Top Navigation Header
  mountGlobalHeader(activePage, pageConfig.sectionLinks || []);

  // 2. Mount Floating Salesperson & Memory Control Bench
  mountControlBench(activePage);

  // 3. Initialize WebOrient SDK v0.3.0
  const weborient = new WebOrient({
    themeColor: '#6366f1',
    accentColor: '#ec4899',
    cursorStyle: 'modern-glow',
    manifestUrl: '../config/sample-manifest.json',
    onEvent: (type, detail) => {
      if (type === 'toolCall') {
        addPersistentLog(detail.name, formatArgsSummary(detail.args));
      } else if (type === 'speechSync' && detail.status === 'speaking') {
        addPersistentLog('Salesperson Voice', `“${detail.text.slice(0, 68)}...”`);
      } else if (type === 'transcript') {
        addPersistentLog('Live Voice AI', detail.text);
      } else if (type === 'interrupted') {
        addPersistentLog('Barge-In', 'Audio & active pitch interrupted by user');
      } else if (type === 'status') {
        syncLiveButtonState(detail.status === 'connected');
      } else if (type === 'memoryUpdate') {
        renderSessionMemoryUI(detail);
        updateHeaderVisitedBadges(detail);
      } else if (type === 'pitchStatus') {
        syncPitchButtonState(detail.running, detail.remaining);
      }
    }
  });
  window.weborient = weborient;

  // 4. Wire Generic Tabs, Carousels, Switches & Control Bench Buttons
  wireGenericTabs();
  wireGenericCarousels();
  wireControlBenchActions(weborient, activePage, pageConfig);
  renderSessionMemoryUI(weborient.memory.getState());
  updateHeaderVisitedBadges(weborient.memory.getState());
  syncPitchButtonState(weborient.memory.state.isPitchRunning, weborient.memory.state.activePitchQueue.length);
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
            <span class="text-[10px] font-mono px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-full">Session-Aware v0.3</span>
          </div>
          <div class="text-[10px] text-slate-400">Synchronized Salesperson Show-and-Describe</div>
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

function updateHeaderVisitedBadges(memState) {
  if (!memState || !Array.isArray(memState.visitedPages)) return;
  for (const pageFile of memState.visitedPages) {
    const badge = document.querySelector(`[data-visit-badge="${pageFile}"]`);
    if (badge && !badge.textContent.includes('✓')) {
      badge.textContent = `${badge.textContent} ✓`;
    }
  }
}

function mountControlBench(activePage) {
  const bench = document.createElement('aside');
  bench.id = 'test-toolbar';
  bench.setAttribute('data-agent-ignore', 'true');
  bench.className = 'fixed bottom-4 right-4 z-50 bg-slate-900/95 backdrop-blur-md border border-slate-700/80 p-3.5 rounded-2xl shadow-2xl max-w-sm w-full max-h-[90vh] overflow-y-auto';

  bench.innerHTML = `
    <div class="flex items-center justify-between mb-2">
      <div class="flex items-center gap-2">
        <span class="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
        <h3 class="font-bold text-xs tracking-wider text-white uppercase">Salesperson &amp; Memory Bench</h3>
      </div>
      <span class="text-[10px] text-indigo-300 font-mono bg-indigo-500/15 px-2 py-0.5 rounded-full border border-indigo-500/30">${activePage.file}</span>
    </div>

    <!-- PRIMARY FEATURE: Synchronized Show & Describe Salesperson Pitch -->
    <div class="mb-2.5 p-2.5 bg-gradient-to-br from-indigo-950/90 via-slate-900 to-pink-950/60 border border-indigo-500/50 rounded-xl space-y-2">
      <div class="flex items-center justify-between">
        <span class="text-[10px] font-mono uppercase tracking-wider text-pink-300 font-semibold">✨ Show &amp; Say in Sync</span>
        <label class="flex items-center gap-1 text-[10px] text-slate-300 cursor-pointer">
          <input type="checkbox" id="chk-mute-tts" class="accent-pink-500">
          <span>Mute TTS</span>
        </label>
      </div>
      <button id="btn-salesperson-pitch" class="w-full py-2.5 bg-gradient-to-r from-pink-600 via-purple-600 to-indigo-600 hover:from-pink-500 hover:to-indigo-500 text-white rounded-lg font-bold text-xs transition shadow-lg shadow-pink-600/25 flex items-center justify-center gap-1.5">
        <span id="pitch-btn-text">▶ Start Multi-Page Salesperson Pitch</span>
      </button>
      <div class="grid grid-cols-2 gap-1.5 pt-0.5">
        <div>
          <label class="block text-[9px] font-mono uppercase text-slate-400 mb-0.5">User Native Language</label>
          <select id="mem-lang-select" class="w-full px-2 py-1 bg-slate-950 border border-slate-700 rounded text-[11px] text-white">
            <option value="en-IN">English (India/Global)</option>
            <option value="hinglish">Hinglish (Hindi + Eng)</option>
            <option value="hi-IN">Hindi (हिन्दी)</option>
            <option value="es-ES">Español (Spanish)</option>
          </select>
        </div>
        <div>
          <label class="block text-[9px] font-mono uppercase text-slate-400 mb-0.5">User Goal / Want</label>
          <input id="mem-goal-input" type="text" class="w-full px-2 py-1 bg-slate-950 border border-slate-700 rounded text-[11px] text-white" placeholder="e.g. Boost SaaS signups">
        </div>
      </div>
    </div>

    <!-- CROSS-PAGE CONSISTENT SESSION MEMORY LEDGER -->
    <div class="mb-2.5 p-2.5 bg-slate-950/90 border border-slate-800 rounded-xl space-y-1.5">
      <div class="flex items-center justify-between">
        <span class="text-[10px] font-mono uppercase tracking-wider text-emerald-400 font-semibold">🧠 Cross-Page Session Memory</span>
        <button id="btn-reset-memory" class="text-[9px] text-slate-400 hover:text-rose-400 underline">Reset Memory</button>
      </div>
      <div class="text-[10px] text-slate-300 flex justify-between">
        <span>Oriented So Far: <strong id="mem-oriented-count" class="text-emerald-400">0</strong></span>
        <span>Left to Describe: <strong id="mem-pending-count" class="text-amber-400">0</strong></span>
      </div>
      <div id="mem-oriented-pills" class="text-[10px] font-mono text-slate-400 truncate"></div>
      <div id="mem-next-up" class="text-[10px] font-mono text-indigo-300 truncate"></div>
    </div>

    <!-- Live Gemini 3.8 Bidirectional Microphone Connection -->
    <div class="mb-2 flex gap-1.5">
      <button id="btn-toggle-live" class="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white rounded-lg font-semibold text-[11px] transition flex items-center justify-center gap-1.5">
        <span class="w-2 h-2 rounded-full bg-red-400" id="live-indicator"></span>
        <span id="live-btn-text">Connect Gemini 3.8 Mic</span>
      </button>
    </div>

    <!-- Text Command Input -->
    <div class="flex gap-1.5 mb-2.5">
      <input id="live-text-prompt" type="text" placeholder="Ask or navigate (e.g. /pricing, tour)..." class="flex-1 px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500">
      <button id="btn-send-prompt" class="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold transition">
        Run
      </button>
    </div>

    <!-- Current Page Local Actions -->
    <div class="mb-2">
      <div class="text-[10px] font-mono uppercase tracking-wider text-slate-400 mb-1">Page Actions (${activePage.badge})</div>
      <div class="grid grid-cols-2 gap-1.5 text-[11px]">
        <button id="btn-local-highlight" class="bg-indigo-600/90 hover:bg-indigo-500 text-white p-1.5 rounded-lg font-medium transition">
          Show &amp; Describe Here
        </button>
        <button id="btn-local-tour" class="bg-purple-600/90 hover:bg-purple-500 text-white p-1.5 rounded-lg font-medium transition">
          Synced Voice Tour
        </button>
        <button id="btn-local-tab" class="bg-sky-600/90 hover:bg-sky-500 text-white p-1.5 rounded-lg font-medium transition">
          Swap Tab / View
        </button>
        <button id="btn-local-swipe" class="bg-amber-600/90 hover:bg-amber-500 text-white p-1.5 rounded-lg font-medium transition">
          Swipe / Toggle Widget
        </button>
        <button id="btn-xpage-pricing" class="bg-slate-800 hover:bg-slate-700 text-indigo-300 p-1.5 rounded-lg font-medium transition">
          ↳ Pricing + Annual
        </button>
        <button id="btn-xpage-contact" class="bg-slate-800 hover:bg-slate-700 text-emerald-300 p-1.5 rounded-lg font-medium transition">
          ↳ Contact + Fill 11
        </button>
      </div>
    </div>

    <!-- Persistent Cross-Page Console Log -->
    <div class="mt-2 pt-2 border-t border-slate-800">
      <div class="text-[10px] font-mono text-slate-400 mb-1 flex justify-between items-center">
        <span>Cross-Page Event Trail</span>
        <div class="flex items-center gap-2">
          <span id="log-count">0 events</span>
          <button id="btn-clear-logs" class="text-[10px] text-slate-500 hover:text-slate-300 underline">Clear</button>
        </div>
      </div>
      <div id="action-log" class="bg-black/70 p-2 rounded-lg text-[10px] font-mono text-emerald-400 h-20 overflow-y-auto space-y-1"></div>
    </div>
  `;

  document.body.appendChild(bench);
}

function renderSessionMemoryUI(memState) {
  if (!memState) return;
  const langSelect = document.getElementById('mem-lang-select');
  const goalInput = document.getElementById('mem-goal-input');
  const orientedCountEl = document.getElementById('mem-oriented-count');
  const pendingCountEl = document.getElementById('mem-pending-count');
  const orientedPillsEl = document.getElementById('mem-oriented-pills');
  const nextUpEl = document.getElementById('mem-next-up');

  if (langSelect && document.activeElement !== langSelect) {
    langSelect.value = memState.userLanguage || 'en-IN';
  }
  if (goalInput && document.activeElement !== goalInput) {
    goalInput.value = memState.userIntent?.goal || '';
  }
  if (orientedCountEl) {
    orientedCountEl.textContent = `${(memState.orientedHistory || []).length} items`;
  }
  if (pendingCountEl) {
    pendingCountEl.textContent = `${(memState.pendingToDescribe || []).length} items`;
  }
  if (orientedPillsEl) {
    const recent = (memState.orientedHistory || []).slice(-3).map(i => `✓ ${i.title || i.selector}`).join(' • ');
    orientedPillsEl.textContent = recent || '✓ Nothing oriented yet (ready for pitch)';
  }
  if (nextUpEl) {
    const nextItem = (memState.pendingToDescribe || [])[0];
    nextUpEl.textContent = nextItem
      ? `Next to describe: ${nextItem.title} (${nextItem.page})`
      : '🎉 All multi-page sections oriented!';
  }
}

function syncPitchButtonState(isRunning, remainingCount = 0) {
  const btn = document.getElementById('btn-salesperson-pitch');
  const txt = document.getElementById('pitch-btn-text');
  if (!btn || !txt) return;

  if (isRunning) {
    txt.textContent = `⏹ Stop Salesperson Pitch (${remainingCount} left)`;
    btn.className = 'w-full py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg font-bold text-xs transition shadow-lg flex items-center justify-center gap-1.5';
  } else {
    txt.textContent = '▶ Start Multi-Page Salesperson Pitch';
    btn.className = 'w-full py-2.5 bg-gradient-to-r from-pink-600 via-purple-600 to-indigo-600 hover:from-pink-500 hover:to-indigo-500 text-white rounded-lg font-bold text-xs transition shadow-lg shadow-pink-600/25 flex items-center justify-center gap-1.5';
  }
}

function wireControlBenchActions(weborient, activePage, pageConfig) {
  // 1. Synchronized Multi-Page Salesperson Pitch Button
  document.getElementById('btn-salesperson-pitch').addEventListener('click', async () => {
    if (weborient.memory.state.isPitchRunning) {
      weborient.stopSalespersonDemo();
      addPersistentLog('Salesperson', 'Paused multi-page pitch (memory preserved)');
    } else {
      const chosenLang = document.getElementById('mem-lang-select').value;
      const chosenGoal = document.getElementById('mem-goal-input').value.trim();
      addPersistentLog('Salesperson', `Starting synchronized pitch (${chosenLang})`);
      await weborient.startSalespersonDemo({
        language: chosenLang,
        goal: chosenGoal || undefined
      });
    }
  });

  // Mute TTS checkbox
  document.getElementById('chk-mute-tts').addEventListener('change', (e) => {
    weborient.speechSync.muted = e.target.checked;
  });

  // Language & Goal Memory Inputs
  document.getElementById('mem-lang-select').addEventListener('change', (e) => {
    weborient.memory.setLanguage(e.target.value);
    addPersistentLog('Memory', `Language set to ${e.target.value}`);
  });

  document.getElementById('mem-goal-input').addEventListener('change', (e) => {
    weborient.memory.updateUserIntent({ goal: e.target.value.trim() });
    addPersistentLog('Memory', `User goal updated: "${e.target.value.trim()}"`);
  });

  document.getElementById('btn-reset-memory').addEventListener('click', () => {
    weborient.stopSalespersonDemo();
    const fresh = weborient.memory.reset();
    renderSessionMemoryUI(fresh);
    addPersistentLog('Memory', 'Reset oriented history & restored full pitch queue');
  });

  // 2. Live Gemini 3.8 Microphone Connection
  let isLiveConnected = false;
  document.getElementById('btn-toggle-live').addEventListener('click', async () => {
    if (!isLiveConnected) {
      document.getElementById('live-btn-text').innerText = 'Connecting...';
      weborient.options.endpoint = 'ws://localhost:8088';
      try {
        await weborient.start();
        isLiveConnected = true;
        syncLiveButtonState(true);
        addPersistentLog('Live Audio', `Connected on ${activePage.file} with Session Memory`);
      } catch (err) {
        document.getElementById('live-btn-text').innerText = 'Relay Offline (Use Pitch Above)';
        addPersistentLog('Notice', 'Relay not running on :8088; use Salesperson Pitch for offline voice');
      }
    } else {
      weborient.stop();
      isLiveConnected = false;
      syncLiveButtonState(false);
      addPersistentLog('Live Audio', 'Disconnected');
    }
  });

  // 3. Text Command Runner
  const promptInput = document.getElementById('live-text-prompt');
  const runPromptCommand = async () => {
    const val = promptInput.value.trim();
    if (!val) return;
    promptInput.value = '';

    // Update user goal in memory if they state what they want
    if (val.toLowerCase().startsWith('i want') || val.toLowerCase().startsWith('goal:')) {
      weborient.memory.updateUserIntent({ goal: val });
    }

    if (weborient.sendTextPrompt(val)) {
      addPersistentLog('Prompt -> AI', val);
      return;
    }

    const lower = val.toLowerCase();
    if (lower.includes('pitch') || lower.includes('sales') || lower.includes('demo')) {
      document.getElementById('btn-salesperson-pitch').click();
    } else if (lower.includes('pricing') || lower === '/pricing') {
      await weborient.handleToolCall('navigate_route', { path: '/pricing' });
    } else if (lower.includes('feature') || lower.includes('arch') || lower === '/features') {
      await weborient.handleToolCall('navigate_route', { path: '/features' });
    } else if (lower.includes('doc') || lower.includes('api') || lower === '/docs') {
      await weborient.handleToolCall('navigate_route', { path: '/docs' });
    } else if (lower.includes('contact') || lower.includes('form') || lower === '/contact') {
      await weborient.handleToolCall('navigate_route', { path: '/contact' });
    } else if (lower.includes('home') || lower === '/') {
      await weborient.handleToolCall('navigate_route', { path: '/' });
    } else {
      const res = await weborient.handleToolCall('read_page_content', { query: val });
      const matched = res.matchingSections?.[0];
      if (matched) {
        await weborient.handleToolCall('show_and_describe', {
          selector: matched.selector,
          explanation: matched.heading,
          spokenText: matched.summary.slice(0, 140)
        });
      }
    }
  };

  document.getElementById('btn-send-prompt').addEventListener('click', runPromptCommand);
  promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runPromptCommand();
  });

  // 4. Cross-Page Quick Workflows
  document.getElementById('btn-xpage-pricing').addEventListener('click', async () => {
    addPersistentLog('Workflow', 'Go Pricing -> Toggle Annual + Describe Pro Plan');
    const postActions = [
      {
        name: 'show_and_describe',
        args: {
          selector: '#plan-pro',
          explanation: 'Pro Co-Pilot with 20% Annual Discount ($64/mo)',
          spokenText: 'Here on the Pricing page, I am toggling Annual billing so you save 20 percent on the Pro Co-Pilot plan.',
          inlineAction: { type: 'swipe_or_swap', selector: '#billing-toggle', action: 'toggle' }
        }
      }
    ];
    if (activePage.id === 'pricing') {
      for (const act of postActions) await weborient.handleToolCall(act.name, act.args);
    } else {
      weborient.queuePostNavigationActions(postActions);
      await weborient.handleToolCall('navigate_route', { path: 'pricing.html' });
    }
  });

  document.getElementById('btn-xpage-contact').addEventListener('click', async () => {
    addPersistentLog('Workflow', 'Go Contact -> Show & Describe 11-Field Batch Form Fill');
    const facts = weborient.memory.state.formFacts;
    const postActions = [
      {
        name: 'show_and_describe',
        args: {
          selector: '#contact-form',
          explanation: 'Filling 11 Enterprise Controls from Session Memory',
          spokenText: `I am filling out the consultation form for ${facts.fullName} at ${facts.company} while keeping the password field untouched.`,
          inlineAction: {
            type: 'fill_form_batch',
            fields: [
              { selector: '#contact-name', value: facts.fullName },
              { selector: '#contact-email', value: 'ajay at deploymate dot in' },
              { selector: '#contact-phone', value: facts.phone },
              { selector: '#contact-company', value: facts.company },
              { selector: '#contact-website', value: facts.website },
              { selector: '#contact-framework', value: 'Next.js / React' },
              { selector: '#contact-plan', value: 'Pro Co-Pilot' },
              { selector: '#contact-team-size', value: facts.teamSize },
              { selector: '#contact-priority', value: 'true' },
              { selector: '#contact-hipaa', value: 'true' },
              { selector: '#contact-message', value: `Goal: ${weborient.memory.state.userIntent.goal}` }
            ]
          }
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

  // 5. Current Page Local Actions (with Synchronized Show & Describe!)
  document.getElementById('btn-local-highlight').addEventListener('click', async () => {
    const target = pageConfig.highlightTarget || { selector: 'h1', explanation: `Active Page: ${document.title}` };
    await weborient.handleToolCall('show_and_describe', {
      selector: target.selector,
      explanation: target.explanation,
      spokenText: target.spokenText || target.explanation
    });
  });

  document.getElementById('btn-local-tour').addEventListener('click', async () => {
    const steps = pageConfig.tourSteps || [
      { selector: 'h1', explanation: '1. Page Headline & Context', dwellMs: 900 },
      { selector: 'section:nth-of-type(2)', explanation: '2. Primary Interactive Module', dwellMs: 900 }
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
    liveBtnText.innerText = 'Listening (Gemini 3.8 Live)';
  } else {
    liveIndicator.className = 'w-2 h-2 rounded-full bg-red-400';
    liveBtnText.innerText = 'Connect Gemini 3.8 Mic';
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
    logBox.innerHTML = `<div class="text-slate-500">Click "▶ Start Multi-Page Salesperson Pitch" above!</div>`;
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
