'use strict';

const RING_CIRCUMFERENCE = 2 * Math.PI * 27;

// Every look is a token swap on :root, so a theme is nothing but a class name.
const THEMES = [
  { id: 'wood', label: '木質' },
  { id: 'gauge', label: '儀器' },
  { id: 'crt', label: '磷光' },
];

// The nub's line runs along this span of its long axis.
const NUB_INSET = 8;
const NUB_SPAN = 44;

const el = {
  orb: document.getElementById('orb'),
  ring: document.getElementById('ring'),
  ringGhost: document.getElementById('ring-ghost'),
  pct: document.getElementById('orb-pct'),
  nub: document.getElementById('nub'),
  nubSvg: document.getElementById('nub-svg'),
  nubShape: document.getElementById('nub-shape'),
  nubLine: document.getElementById('nub-line'),
  panel: document.getElementById('panel'),
  title: document.getElementById('panel-title'),
  settingsToggle: document.getElementById('settings-toggle'),
  viewMetrics: document.getElementById('view-metrics'),
  viewSettings: document.getElementById('view-settings'),
  metrics: document.getElementById('metrics'),
  empty: document.getElementById('empty'),
  idleOpacity: document.getElementById('idle-opacity'),
  idleValue: document.getElementById('idle-value'),
  standbyMs: document.getElementById('standby-ms'),
  standbyValue: document.getElementById('standby-value'),
  collapseMs: document.getElementById('collapse-ms'),
  collapseValue: document.getElementById('collapse-value'),
  themeValue: document.getElementById('theme-value'),
  themePicker: document.getElementById('theme-picker'),
  statuslineValue: document.getElementById('statusline-value'),
  statuslineAction: document.getElementById('statusline-action'),
  statuslineHint: document.getElementById('statusline-hint'),
  autostartToggle: document.getElementById('autostart-toggle'),
  autostartHint: document.getElementById('autostart-hint'),
};

let state = {
  metrics: [],
  highest: null,
  recent: null,
  mode: 'orb',
  dockEdge: null,
  expanded: false,
  settings: { theme: 'wood', idleOpacity: 0.42, standbyMs: 5000, collapseMs: 5000 },
};

let standby = false;
let showingSettings = false;
let standbyTimer = null;
let collapseTimer = null;

// null until the main process has been asked; then 'absent' | 'installed' | 'foreign'.
let statusline = { status: null, needsNode: false };
// A status line someone else configured is only replaced on a second click.
let replaceArmed = false;

// null until asked; then 'unavailable' | 'enabled' | 'disabled'.
let autostart = null;

el.ring.style.strokeDasharray = String(RING_CIRCUMFERENCE);
el.ringGhost.style.strokeDasharray = String(RING_CIRCUMFERENCE);

function severity(m) {
  if (!m || m.stale) return 'stale';
  if (m.usedPct >= 90) return 'danger';
  if (m.usedPct >= 70) return 'warn';
  return '';
}

// Source colour first, then severity. Below the danger line the source keeps the
// ring so the orb stays identifiable without a label.
function classesFor(m, withStandby) {
  const out = [`accent-${m?.accent ?? 'default'}`];
  const sev = severity(m);
  if (sev) out.push(sev);
  if (withStandby && standby) out.push('idle');
  return out.join(' ');
}

function collapsed() {
  return Boolean(state.dockEdge) && !state.expanded && state.mode !== 'panel';
}

function render() {
  const isCollapsed = collapsed();

  el.panel.classList.toggle('hidden', state.mode !== 'panel');
  el.nub.classList.toggle('hidden', !isCollapsed);
  el.orb.classList.toggle('hidden', state.mode === 'panel' || isCollapsed);

  document.documentElement.style.setProperty('--idle-opacity', String(state.settings.idleOpacity));
  document.documentElement.className = `theme-${currentTheme()}`;

  if (state.mode === 'panel') renderPanel();
  else if (isCollapsed) renderNub();
  else renderOrb();

  if (state.mode === 'panel') stopTimers();
  else restartTimers();
}

let currentDisplayPct = null;
let pctAnimFrame = null;

function animatePct(targetPct) {
  if (typeof targetPct !== 'number' || isNaN(targetPct)) {
    if (pctAnimFrame) {
      cancelAnimationFrame(pctAnimFrame);
      pctAnimFrame = null;
    }
    el.pct.textContent = '--';
    currentDisplayPct = null;
    return;
  }

  if (currentDisplayPct === null) {
    currentDisplayPct = targetPct;
    el.pct.textContent = `${Math.round(targetPct)}%`;
    return;
  }

  if (pctAnimFrame) {
    cancelAnimationFrame(pctAnimFrame);
    pctAnimFrame = null;
  }

  const startPct = currentDisplayPct;
  const target = targetPct;
  if (Math.abs(target - startPct) < 0.1) {
    currentDisplayPct = target;
    el.pct.textContent = `${Math.round(target)}%`;
    return;
  }

  const startTime = performance.now();
  const duration = 650;

  function step(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 4);
    const current = startPct + (target - startPct) * ease;
    currentDisplayPct = current;
    el.pct.textContent = `${Math.round(current)}%`;

    if (progress < 1) {
      pctAnimFrame = requestAnimationFrame(step);
    } else {
      currentDisplayPct = target;
      el.pct.textContent = `${Math.round(target)}%`;
      pctAnimFrame = null;
    }
  }

  pctAnimFrame = requestAnimationFrame(step);
}

function renderOrb() {
  const m = state.highest;
  const pct = m ? m.usedPct : 0;

  el.orb.className = classesFor(m, true);
  const offset = String(RING_CIRCUMFERENCE * (1 - Math.min(pct, 100) / 100));
  el.ring.style.strokeDashoffset = offset;
  // Same target, slower transition: the lag is the whole point.
  el.ringGhost.style.strokeDashoffset = offset;
  animatePct(m && typeof m.usedPct === 'number' ? m.usedPct : null);
}

function renderNub() {
  // Collapsed, the nub reports what is being consumed rather than what is most
  // exhausted — otherwise it would sit on a maxed-out window indefinitely.
  const m = state.recent;
  const edge = state.dockEdge;
  const vertical = edge === 'left' || edge === 'right';
  const length = NUB_SPAN * (Math.min(m ? m.usedPct : 0, 100) / 100);

  el.nub.className = classesFor(m, true);

  // The window sits at the OS minimum size; only this sliver against the docked
  // edge is painted, so the visible nub stays as discreet as intended.
  if (vertical) {
    el.nubSvg.setAttribute('viewBox', '0 0 32 60');
    const outer = edge === 'right' ? 32 : 0;
    const inner = edge === 'right' ? 18 : 14;
    el.nubShape.setAttribute('points', `${outer},1 ${outer},59 ${inner},52 ${inner},8`);

    const x = (outer + inner) / 2;
    el.nubLine.setAttribute('x1', x);
    el.nubLine.setAttribute('x2', x);
    el.nubLine.setAttribute('y1', NUB_INSET + NUB_SPAN);
    el.nubLine.setAttribute('y2', NUB_INSET + NUB_SPAN - length);
  } else {
    el.nubSvg.setAttribute('viewBox', '0 0 60 40');
    const outer = edge === 'bottom' ? 40 : 0;
    const inner = edge === 'bottom' ? 26 : 14;
    el.nubShape.setAttribute('points', `1,${outer} 59,${outer} 52,${inner} 8,${inner}`);

    const y = (outer + inner) / 2;
    el.nubLine.setAttribute('y1', y);
    el.nubLine.setAttribute('y2', y);
    el.nubLine.setAttribute('x1', NUB_INSET);
    el.nubLine.setAttribute('x2', NUB_INSET + length);
  }
}

function renderPanel() {
  el.title.textContent = showingSettings ? '設定' : 'Usage Monitor';
  el.settingsToggle.classList.toggle('active', showingSettings);
  el.viewMetrics.classList.toggle('hidden', showingSettings);
  el.viewSettings.classList.toggle('hidden', !showingSettings);

  if (showingSettings) renderSettings();
  else renderMetrics();
}

function renderMetrics() {
  // Ranked metrics first, then the informational balances.
  const metrics = [...state.metrics].sort((a, b) => {
    const av = typeof a.usedPct === 'number' ? a.usedPct : -1;
    const bv = typeof b.usedPct === 'number' ? b.usedPct : -1;
    return bv - av;
  });

  el.empty.classList.toggle('hidden', metrics.length > 0);
  el.metrics.replaceChildren(...metrics.map(metricRow));
}

// A settings file from an older build, or one hand-edited to something that no
// longer exists, falls back rather than leaving the page with no theme at all.
function currentTheme() {
  return THEMES.some((t) => t.id === state.settings.theme) ? state.settings.theme : 'wood';
}

function renderTheme() {
  const id = currentTheme();
  el.themeValue.textContent = THEMES.find((t) => t.id === id).label;
  for (const option of el.themePicker.children) {
    option.classList.toggle('selected', option.dataset.theme === id);
  }
}

function renderSettings() {
  const sync = (input, value) => {
    // Leave a control alone while it is being dragged.
    if (document.activeElement !== input) input.value = String(value);
  };

  sync(el.standbyMs, state.settings.standbyMs);
  sync(el.collapseMs, state.settings.collapseMs);
  sync(el.idleOpacity, Math.round(state.settings.idleOpacity * 100));

  el.standbyValue.textContent = seconds(el.standbyMs.value);
  el.collapseValue.textContent = seconds(el.collapseMs.value);
  el.idleValue.textContent = `${el.idleOpacity.value}%`;

  renderTheme();
  renderStatusline();
  renderAutostart();
}

function renderAutostart() {
  el.autostartToggle.disabled = autostart === null || autostart === 'unavailable';
  el.autostartToggle.checked = autostart === 'enabled';

  el.autostartHint.textContent =
    autostart === 'unavailable'
      ? '免安裝版每次啟動的路徑都不固定，開機自動啟動只在安裝版可用'
      : '';
}

function renderStatusline() {
  const { status, needsNode } = statusline;
  el.statuslineAction.disabled = status === null;

  if (status === 'installed') {
    el.statuslineValue.textContent = '已安裝';
    el.statuslineAction.textContent = '移除';
    el.statuslineHint.textContent = needsNode
      ? '免安裝版沒有自己的執行環境，這條 statusline 需要系統已安裝 Node.js'
      : '重開 Claude Code 並送出一則訊息後才會有數字';
  } else if (status === 'foreign') {
    el.statuslineValue.textContent = '其他設定';
    el.statuslineAction.textContent = replaceArmed ? '確定取代？再按一次' : '取代現有 statusline';
    el.statuslineHint.textContent = 'Claude Code 已經有自訂 statusline，取代後原本那份會消失';
  } else {
    el.statuslineValue.textContent = status === null ? '檢查中' : '未安裝';
    el.statuslineAction.textContent = '安裝';
    el.statuslineHint.textContent = 'Claude 的額度只有 statusline 拿得到，沒裝就永遠是灰的';
  }
}

async function refreshStatusline() {
  statusline = { ...statusline, status: await window.monitor.statuslineStatus() };
  replaceArmed = false;
  renderStatusline();
}

async function refreshAutostart() {
  autostart = await window.monitor.autostartStatus();
  renderAutostart();
}

function seconds(ms) {
  return `${Number(ms) / 1000} 秒`;
}

function metricRow(m) {
  const li = document.createElement('li');
  li.className = `metric ${classesFor(m, false)}`;

  const head = document.createElement('div');
  head.className = 'metric-head';

  const label = document.createElement('span');
  label.className = 'metric-label';
  label.textContent = m.label;

  const value = document.createElement('span');
  value.className = 'metric-pct';
  // Metrics without a trustworthy denominator show their raw balance instead.
  value.textContent = typeof m.usedPct === 'number' ? `${Math.round(m.usedPct)}%` : m.text;

  head.append(label, value);
  li.append(head);

  if (typeof m.usedPct === 'number') {
    const bar = document.createElement('div');
    bar.className = 'bar';
    const fill = document.createElement('span');
    fill.style.width = `${Math.min(m.usedPct, 100)}%`;
    bar.append(fill);
    li.append(bar);
  }

  const note = describe(m);
  if (note) {
    const p = document.createElement('p');
    p.className = 'metric-note';
    p.textContent = note;
    li.append(p);
  }

  return li;
}

function describe(m) {
  // Staleness is stated outright rather than papered over with an estimate.
  if (m.stale) return `資料截至 ${clock(m.updatedAt)}`;
  if (m.resetsAt) return `${countdown(m.resetsAt)}後重置`;
  return '';
}

function clock(ts) {
  return new Date(ts).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function countdown(ts) {
  const minutes = Math.max(0, Math.round((ts - Date.now()) / 60000));
  if (minutes < 60) return `${minutes} 分鐘`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} 小時 ${rest} 分` : `${hours} 小時`;
}

/* ---------- Standby and collapse ---------- */

function paintStandby() {
  (collapsed() ? el.nub : el.orb).classList.toggle('idle', standby);
}

function restartTimers() {
  clearTimeout(standbyTimer);
  clearTimeout(collapseTimer);

  standby = false;
  paintStandby();
  standbyTimer = setTimeout(() => {
    standby = true;
    paintStandby();
  }, state.settings.standbyMs);

  // Only an orb that was opened out of a nub has somewhere to collapse back to;
  // scheduling it otherwise would just bounce state changes back and forth.
  if (state.dockEdge && state.expanded) {
    collapseTimer = setTimeout(() => window.monitor.settleDock(), state.settings.collapseMs);
  }
}

function stopTimers() {
  clearTimeout(standbyTimer);
  clearTimeout(collapseTimer);
  standby = false;
  paintStandby();
}

document.addEventListener('pointermove', () => {
  if (state.mode !== 'panel') restartTimers();
});

/* ---------- Opening the nub ---------- */

// Hovering only lifts the nub out of standby; it takes a click to open the orb.
el.nub.addEventListener('click', () => window.monitor.expand());

/* ---------- Drag, and click as the absence of a drag ---------- */

let dragging = false;

function endDrag(e) {
  if (!dragging) return;
  dragging = false;
  if (e?.pointerId !== undefined && el.orb.hasPointerCapture(e.pointerId)) {
    el.orb.releasePointerCapture(e.pointerId);
  }
  window.monitor.dragEnd();
}

el.orb.addEventListener('pointerdown', (e) => {
  el.orb.setPointerCapture(e.pointerId);
  dragging = true;
  window.monitor.dragStart();
});

// Following the cursor is the main process's job; nothing about the movement
// needs reporting from here. Only the release does.

// A pointerup can go missing when the window moves out from under the pointer.
// Any later move carrying no button says the release already happened, which
// catches it without putting a time limit on how long a drag may be held still.
document.addEventListener('pointermove', (e) => {
  if (dragging && e.buttons === 0) endDrag(e);
});

// The release is watched for in several places because capture can be lost
// mid-drag, and then pointerup never reaches the orb at all. Whichever arrives
// first ends the drag; the rest are no-ops.
el.orb.addEventListener('pointerup', endDrag);
el.orb.addEventListener('lostpointercapture', endDrag);
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);
window.addEventListener('blur', () => endDrag());

/* ---------- Panel controls ---------- */

el.settingsToggle.addEventListener('click', () => {
  showingSettings = !showingSettings;
  renderPanel();
  // Claude Code's settings can change behind the app's back, so the state is
  // re-read every time the page is opened rather than cached from startup.
  if (showingSettings) {
    refreshStatusline();
    refreshAutostart();
  }
});

el.themePicker.addEventListener('click', (e) => {
  const option = e.target.closest('.theme-option');
  if (option) window.monitor.setSetting('theme', option.dataset.theme);
});

el.statuslineAction.addEventListener('click', async () => {
  if (statusline.status === 'installed') {
    statusline = await window.monitor.statuslineUninstall();
  } else if (statusline.status === 'foreign' && !replaceArmed) {
    replaceArmed = true;
  } else {
    statusline = await window.monitor.statuslineInstall();
    replaceArmed = false;
  }
  renderStatusline();
});

el.autostartToggle.addEventListener('change', async () => {
  autostart = await window.monitor.autostartSet(el.autostartToggle.checked);
  renderAutostart();
});

const bindSlider = (input, key, transform, label) => {
  input.addEventListener('input', () => {
    label();
    window.monitor.setSetting(key, transform(Number(input.value)));
  });
};

bindSlider(el.standbyMs, 'standbyMs', (v) => v, () => (el.standbyValue.textContent = seconds(el.standbyMs.value)));
bindSlider(el.collapseMs, 'collapseMs', (v) => v, () => (el.collapseValue.textContent = seconds(el.collapseMs.value)));
bindSlider(el.idleOpacity, 'idleOpacity', (v) => v / 100, () => (el.idleValue.textContent = `${el.idleOpacity.value}%`));

document.getElementById('open-claude').addEventListener('click', () => window.monitor.openClaudeUsage());
document.getElementById('quit').addEventListener('click', () => window.monitor.quit());

window.monitor.onState((next) => {
  state = next;
  render();
});

render();
