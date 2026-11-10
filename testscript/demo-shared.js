/**
 * WebOrient Multi-Page Demo Shared Shell & Non-Linear To-Do Memory Bench (v0.4.0)
 * - ZERO Browser TTS: Connects directly to the Gemini 3.8 Live Model for natural, adaptive orientation
 * - Interactive Non-Linear To-Do Checklist:
 *   Displays all 14 sections across the 5 pages (`✓ Done` vs `☐ Pending`). Clicking any item (or
 *   asking the Live Model about any topic in any order) jumps to that section, highlights it with the
 *   Ghost Cursor, and checks off that To-Do item regardless of order!
 * - Real-Time Transcript-to-DOM Auto-Grounding:
 *   Whenever the Live Model describes a DOM element in speech, the Ghost Cursor automatically scrolls
 *   to it, highlights it, and checks off its To-Do item.
 * - Refresh-Safe & Redirect-Safe Session Management:
 *   Persists `sessionId`, `userLanguage`, `userGoal`, and `todoChecklist` in `localStorage` so hard
 *   browser refreshes (`F5`/`Cmd+R`) and page redirects never lose the user or their language!
 */
import { WebOrient } from '../src/sdk/weborient.js';

const LOG_STORAGE_KEY = 'weborient_multipage_demo_logs_v4';

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

  mountGlobalHeader(activePage, pageConfig.sectionLinks || []);
  mountControlBench(activePage);

  const weborient = new WebOrient({
    themeColor: '#6366f1',
    accentColor: '#ec4899',
    cursorStyle: 'modern-glow',
    manifestUrl: '../config/sample-manifest.json',
    onEvent: (type, detail) => {
      if (type === 'toolCall') {
        addPersistentLog(detail.name, formatArgsSummary(detail.args));
      } else if (type === 'autoGrounded') {
        addPersistentLog('Auto-Highlight', `Spoken DOM match -> ${detail.selector} (${detail.title})`);
      } else if (type === 'transcript') {
        const prefix = detail.role === 'user' ? 'User Spoke' : 'Gemini Live';
        addPersistentLog(prefix, detail.text);
      } else if (type === 'interrupted') {
        addPersistentLog('Barge-In', 'User interrupted audio stream');
      } else if (type === 'status') {
        syncLiveButtonState(detail.status === 'connected');
      } else if (type === 'sessionRestored') {
        syncLiveButtonState(true);
        addPersistentLog('Session Restored', `Resumed ${detail.sessionId} in ${detail.language}`);
      } else if (type === 'memoryUpdate') {
        renderSessionMemoryUI(detail, weborient);
        updateHeaderVisitedBadges(detail);
      }
    }
  });
  window.weborient = weborient;

  wireGenericTabs(weborient);
  wireGenericCarousels(weborient);
  wireControlBenchActions(weborient, activePage, pageConfig);
  renderSessionMemoryUI(weborient.memory.getState(), weborient);
  updateHeaderVisitedBadges(weborient.memory.getState());
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
            <span class="text-[10px] font-mono px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-full">Live-Adaptive v0.4</span>
          </div>
          <div class="text-[10px] text-slate-400">Non-Linear To-Do Memory &amp; Refresh-Safe Live Voice</div>
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

function mountControlBench(activePage) {
  const bench = document.createElement('aside');
  bench.id = 'test-toolbar';
  bench.setAttribute('data-agent-ignore', 'true');
  bench.className = 'fixed bottom-4 right-4 z-50 bg-slate-900/95 backdrop-blur-md border border-slate-700/80 p-3.5 rounded-2xl shadow-2xl max-w-sm w-full max-h-[90vh] overflow-y-auto';

  bench.innerHTML = `
    <div class="flex items-center justify-between mb-2">
      <div class="flex items-center gap-2">
        <span class="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
        <h3 class="font-bold text-xs tracking-wider text-white uppercase">Live Co-Pilot &amp; To-Do Memory</h3>
      </div>
      <span id="session-id-pill" class="text-[9px] text-indigo-300 font-mono bg-indigo-500/15 px-2 py-0.5 rounded-full border border-indigo-500/30">${activePage.file}</span>
    </div>

    <!-- 1. Gemini 3.8 Live Voice Connection & Language Lock -->
    <div class="mb-2.5 p-2.5 bg-gradient-to-br from-indigo-950/90 via-slate-900 to-purple-950/60 border border-indigo-500/50 rounded-xl space-y-2">
      <button id="btn-toggle-live" class="w-full py-2.5 bg-gradient-to-r from-indigo-500 via-purple-600 to-pink-600 hover:from-indigo-600 hover:to-pink-700 text-white rounded-lg font-bold text-xs transition flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/25">
        <span class="w-2.5 h-2.5 rounded-full bg-red-400" id="live-indicator"></span>
        <span id="live-btn-text">🎙️ Connect Gemini 3.8 Live Salesperson</span>
      </button>

      <div class="grid grid-cols-2 gap-1.5 pt-0.5">
        <div>
          <label class="block text-[9px] font-mono uppercase text-indigo-300 mb-0.5">Locked Session Language</label>
          <select id="mem-lang-select" class="w-full px-2 py-1 bg-slate-950 border border-slate-700 rounded text-[11px] text-white">
            <option value="en-IN">English (India/Global)</option>
            <option value="hinglish">Hinglish (Hindi + Eng)</option>
            <option value="hi-IN">Hindi (हिन्दी)</option>
            <option value="es-ES">Español (Spanish)</option>
            <option value="fr-FR">Français (French)</option>
          </select>
        </div>
        <div>
          <label class="block text-[9px] font-mono uppercase text-indigo-300 mb-0.5">User Want / Goal</label>
          <input id="mem-goal-input" type="text" class="w-full px-2 py-1 bg-slate-950 border border-slate-700 rounded text-[11px] text-white" placeholder="e.g. Need SaaS voice form">
        </div>
      </div>
    </div>

    <!-- 2. NON-LINEAR TO-DO CHECKLIST MEMORY (Any Order!) -->
    <div class="mb-2.5 p-2.5 bg-slate-950/90 border border-slate-800 rounded-xl space-y-1.5">
      <div class="flex items-center justify-between">
        <span class="text-[10px] font-mono uppercase tracking-wider text-emerald-400 font-semibold">☑️ Non-Linear To-Do Memory (Any Order)</span>
        <div class="flex items-center gap-2">
          <span id="todo-progress-badge" class="text-[10px] font-mono text-indigo-300 font-bold">0/14</span>
          <button id="btn-reset-memory" class="text-[9px] text-slate-400 hover:text-rose-400 underline">Reset</button>
        </div>
      </div>
      <p class="text-[10px] text-slate-400 leading-tight">Click any topic in any order (or ask the Live Model)—it jumps there, highlights the DOM, and checks it off:</p>
      <div id="todo-checklist-box" class="max-h-36 overflow-y-auto space-y-1 pr-1 pt-1"></div>
    </div>

    <!-- 3. Ask or Navigate Input -->
    <div class="flex gap-1.5 mb-2.5">
      <input id="live-text-prompt" type="text" placeholder="Ask Live Model or jump (e.g. ROI, SLA, /pricing)..." class="flex-1 px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500">
      <button id="btn-send-prompt" class="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold transition">
        Go
      </button>
    </div>

    <!-- 4. Instant DOM Action Triggers -->
    <div class="mb-2">
      <div class="text-[10px] font-mono uppercase tracking-wider text-slate-400 mb-1">DOM Actions (${activePage.badge})</div>
      <div class="grid grid-cols-2 gap-1.5 text-[11px]">
        <button id="btn-local-highlight" class="bg-indigo-600/90 hover:bg-indigo-500 text-white p-1.5 rounded-lg font-medium transition">
          Highlight Section
        </button>
        <button id="btn-local-tour" class="bg-purple-600/90 hover:bg-purple-500 text-white p-1.5 rounded-lg font-medium transition">
          Tour Page DOM
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

    <!-- 5. Persistent Cross-Page & Refresh-Safe Log -->
    <div class="mt-2 pt-2 border-t border-slate-800">
      <div class="text-[10px] font-mono text-slate-400 mb-1 flex justify-between items-center">
        <span>Session Event Trail (Survives Refresh)</span>
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

function renderSessionMemoryUI(memState, weborient) {
  if (!memState) return;
  const langSelect = document.getElementById('mem-lang-select');
  const goalInput = document.getElementById('mem-goal-input');
  const progressBadge = document.getElementById('todo-progress-badge');
  const checklistBox = document.getElementById('todo-checklist-box');
  const sessionPill = document.getElementById('session-id-pill');

  if (sessionPill && memState.sessionId) {
    sessionPill.textContent = `${memState.sessionId.slice(0, 12)} • ${memState.userLanguage}`;
  }
  if (langSelect && document.activeElement !== langSelect) {
    langSelect.value = memState.userLanguage || 'en-IN';
  }
  if (goalInput && document.activeElement !== goalInput) {
    goalInput.value = memState.userIntent?.goal || '';
  }

  const todos = memState.todoChecklist || [];
  const doneCount = todos.filter(t => t.done).length;
  if (progressBadge) {
    progressBadge.textContent = `${doneCount}/${todos.length} Done`;
  }

  if (checklistBox) {
    const currentFile = window.location.pathname.split('/').pop() || 'test-demo.html';
    // Sort current page items first so user sees active page To-Dos at top, followed by other pages
    const sorted = [...todos].sort((a, b) => {
      const aHere = a.page === currentFile ? 0 : 1;
      const bHere = b.page === currentFile ? 0 : 1;
      return aHere - bHere;
    });

    checklistBox.innerHTML = sorted.map(item => {
      const isCurrentPage = item.page === currentFile;
      return `
        <button data-todo-id="${item.id}" class="w-full text-left px-2 py-1 rounded flex items-center justify-between gap-1.5 text-[10px] transition ${
          item.done
            ? 'bg-emerald-950/40 border border-emerald-500/30 text-emerald-300'
            : (isCurrentPage ? 'bg-slate-900 hover:bg-indigo-950/60 border border-slate-800 text-slate-200' : 'bg-slate-900/40 hover:bg-slate-800/60 text-slate-400')
        }">
          <span class="truncate">
            <strong class="mr-1">${item.done ? '✓' : '☐'}</strong>
            <span>${item.title}</span>
          </span>
          <span class="text-[9px] font-mono px-1.5 py-0.5 rounded bg-slate-950/80 text-slate-400 flex-shrink-0">${item.page.replace('.html', '')}</span>
        </button>
      `;
    }).join('');

    checklistBox.querySelectorAll('[data-todo-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const todoId = btn.getAttribute('data-todo-id');
        const targetTodo = todos.find(t => t.id === todoId);
        if (targetTodo && weborient) {
          addPersistentLog('To-Do Selected', `Jumping to "${targetTodo.title}" (${targetTodo.page})`);
          weborient.orientTopic(targetTodo);
        }
      });
    });
  }
}

function wireControlBenchActions(weborient, activePage, pageConfig) {
  // 1. Live Gemini 3.8 Microphone Connection
  document.getElementById('btn-toggle-live').addEventListener('click', async () => {
    if (!weborient.client) {
      document.getElementById('live-btn-text').innerText = 'Connecting to Gemini 3.8 Live...';
      weborient.options.endpoint = 'ws://localhost:8088';
      try {
        await weborient.start();
        syncLiveButtonState(true);
        addPersistentLog('Live Audio', `Connected (${weborient.memory.state.sessionId}) in ${weborient.memory.state.userLanguage}`);
      } catch (err) {
        document.getElementById('live-btn-text').innerText = 'Relay Offline (Run npm run relay)';
        addPersistentLog('Error', 'Start relay (`python3 src/relay/weborient_relay.py`) for live voice');
      }
    } else {
      weborient.stop();
      syncLiveButtonState(false);
      addPersistentLog('Live Audio', 'Disconnected by user');
    }
  });

  // 2. Language Lock & User Goal Persistence (Survives Redirects & Refreshes!)
  document.getElementById('mem-lang-select').addEventListener('change', (e) => {
    const newLang = e.target.value;
    const cfg = weborient.memory.setLanguage(newLang, true);
    addPersistentLog('Language Locked', `${cfg.name} (${cfg.code}) persisted across pages & refresh`);
    if (weborient.client) {
      weborient.client.sendText(
        `[LANGUAGE UPDATE]: The user set their native language to ${cfg.name} (${cfg.code}). Speak strictly in ${cfg.name} from now on across all pages.`
      );
    }
  });

  document.getElementById('mem-goal-input').addEventListener('change', (e) => {
    const newGoal = e.target.value.trim();
    weborient.memory.updateUserIntent({ goal: newGoal });
    addPersistentLog('User Goal Saved', `"${newGoal}"`);
    if (weborient.client) {
      weborient.client.sendText(`[USER GOAL UPDATE]: The user wants: "${newGoal}". Adapt your orientation to focus on this goal.`);
    }
  });

  document.getElementById('btn-reset-memory').addEventListener('click', () => {
    const fresh = weborient.memory.reset();
    renderSessionMemoryUI(fresh, weborient);
    addPersistentLog('Memory Reset', 'Cleared completed To-Do items; language & connection preserved');
  });

  // 3. Natural Language / Topic Jump Input (Non-Linear!)
  const promptInput = document.getElementById('live-text-prompt');
  const runPromptCommand = async () => {
    const val = promptInput.value.trim();
    if (!val) return;
    promptInput.value = '';

    // Check if the user typed a topic matching any To-Do item across the 5 pages
    const lower = val.toLowerCase();
    const matchedTodo = weborient.memory.state.todoChecklist.find(
      t => t.title.toLowerCase().includes(lower) ||
           (t.keywords || []).some(k => lower.includes(k.toLowerCase()))
    );

    if (weborient.sendTextPrompt(val)) {
      addPersistentLog('User -> Live AI', val);
      if (matchedTodo && matchedTodo.page === activePage.file) {
        await weborient.handleToolCall('move_and_highlight', {
          selector: matchedTodo.selector,
          explanation: matchedTodo.title
        });
      }
      return;
    }

    // Offline interactive fallback: jump to any matched To-Do or route in any order!
    if (matchedTodo) {
      await weborient.orientTopic(matchedTodo);
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
      await weborient.handleToolCall('read_page_content', { query: val });
    }
  };

  document.getElementById('btn-send-prompt').addEventListener('click', runPromptCommand);
  promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runPromptCommand();
  });

  // 4. Cross-Page Quick Workflows
  document.getElementById('btn-xpage-pricing').addEventListener('click', async () => {
    addPersistentLog('Workflow', 'Go Pricing -> Toggle Annual + Highlight Pro');
    const postActions = [
      { name: 'swipe_or_swap', args: { selector: '#billing-toggle', action: 'toggle' } },
      { name: 'move_and_highlight', args: { selector: '#plan-pro', explanation: 'Pro Co-Pilot with 20% Annual Discount ($64/mo)' } }
    ];
    if (activePage.id === 'pricing') {
      for (const act of postActions) await weborient.handleToolCall(act.name, act.args);
    } else {
      weborient.queuePostNavigationActions(postActions);
      await weborient.handleToolCall('navigate_route', { path: 'pricing.html' });
    }
  });

  document.getElementById('btn-xpage-contact').addEventListener('click', async () => {
    addPersistentLog('Workflow', 'Go Contact -> Batch Fill 11 Enterprise Controls');
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
            { selector: '#contact-message', value: `Goal: ${weborient.memory.state.userIntent.goal}` }
          ]
        }
      },
      { name: 'move_and_highlight', args: { selector: '#btn-submit-contact', explanation: 'All 11 Enterprise fields validated!' } }
    ];
    if (activePage.id === 'contact') {
      for (const act of postActions) await weborient.handleToolCall(act.name, act.args);
    } else {
      weborient.queuePostNavigationActions(postActions);
      await weborient.handleToolCall('navigate_route', { path: 'contact.html' });
    }
  });

  // 5. Current Page Local Actions
  document.getElementById('btn-local-highlight').addEventListener('click', async () => {
    const target = pageConfig.highlightTarget || { selector: 'h1', explanation: `Active Page: ${document.title}` };
    await weborient.handleToolCall('move_and_highlight', target);
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
    localStorage.removeItem(LOG_STORAGE_KEY);
    renderStoredLogs();
  });
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

        // Also mark enclosing section oriented when user manually interacts with tabs!
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

function syncLiveButtonState(connected) {
  const liveIndicator = document.getElementById('live-indicator');
  const liveBtnText = document.getElementById('live-btn-text');
  if (!liveIndicator || !liveBtnText) return;
  if (connected) {
    liveIndicator.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping';
    liveBtnText.innerText = '🟢 Live Model Connected (Speak in Any Order)';
  } else {
    liveIndicator.className = 'w-2.5 h-2.5 rounded-full bg-red-400';
    liveBtnText.innerText = '🎙️ Connect Gemini 3.8 Live Salesperson';
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
    const raw = localStorage.getItem(LOG_STORAGE_KEY);
    const logs = raw ? JSON.parse(raw) : [];
    const pageName = window.location.pathname.split('/').pop() || 'home';
    logs.push({
      page: pageName.replace('.html', ''),
      action,
      details,
      time: new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
    });
    const trimmed = logs.slice(-40);
    localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(trimmed));
  } catch (_) {}
  renderStoredLogs();
}

function renderStoredLogs() {
  const logBox = document.getElementById('action-log');
  const logCountEl = document.getElementById('log-count');
  if (!logBox || !logCountEl) return;

  let logs = [];
  try {
    const raw = localStorage.getItem(LOG_STORAGE_KEY);
    logs = raw ? JSON.parse(raw) : [];
  } catch (_) {}

  logCountEl.innerText = `${logs.length} events`;
  if (logs.length === 0) {
    logBox.innerHTML = `<div class="text-slate-500">Click any To-Do item above in any order or connect Gemini Live!</div>`;
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
