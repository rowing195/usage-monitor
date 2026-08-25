'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, ipcMain, screen, shell } = require('electron');
const providers = require('./providers');
const statusline = require('./statusline-setup');
const autostart = require('./autostart');
const tray = require('./tray');

// Quitting is one click away from the orb, so where it sat has to survive it.
const STATE_FILE = path.join(os.homedir(), '.usage-monitor', 'window-state.json');
const SETTINGS_FILE = path.join(os.homedir(), '.usage-monitor', 'settings.json');

const DEFAULT_SETTINGS = {
  idleOpacity: 0.42,
  standbyMs: 5000, // Going quiet: fade to the idle opacity.
  collapseMs: 5000, // Going quiet: re-evaluate docking and collapse.
};

// The window is larger than the orb itself: the disc is 62px across and its
// glow needs room to fall off before the window clips it. The extra area is
// transparent and not interactive — only the disc responds to the pointer.
const ORB = { width: 120, height: 120 };

// Windows will not make a window thinner than roughly 32x39 (SM_CYMINTRACK), so
// the collapsed window sits at that floor and the renderer draws its sliver
// against the docked edge, leaving the rest transparent.
const NUB_VERTICAL = { width: 32, height: 60 };
const NUB_HORIZONTAL = { width: 60, height: 40 };

const PANEL = { width: 320, height: 420 };

// How close to a screen edge the orb must be before it docks.
const DOCK_THRESHOLD = 24;
// Pointer travel below this is a click, not a drag.
const CLICK_SLOP = 4;
// How often a drag re-reads the cursor and repositions the window.
const DRAG_FRAME_MS = 8;

let win = null;
let dockEdge = null; // null | 'left' | 'right' | 'top' | 'bottom'
let mode = 'orb'; // 'orb' | 'panel'
let expanded = false; // Orb shown in place of its collapsed nub.
let orbBounds = null; // Where the orb sat before the panel took over the window.
let drag = null; // { origin, cursor, moved, x, y }
let dragTick = null;
let latest = { metrics: [], highest: null, recent: null };
let settings = { ...DEFAULT_SETTINGS };

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function workArea() {
  return screen.getDisplayMatching(win.getBounds()).workArea;
}

function nubSize() {
  return dockEdge === 'left' || dockEdge === 'right' ? NUB_VERTICAL : NUB_HORIZONTAL;
}

// While docked the window sits flush against its edge, holding whatever position
// it already had along the other axis.
function dockedBounds(size) {
  const area = workArea();
  const b = win.getBounds();
  const y = clamp(b.y, area.y, area.y + area.height - size.height);
  const x = clamp(b.x, area.x, area.x + area.width - size.width);

  switch (dockEdge) {
    case 'left':
      return { x: area.x, y, ...size };
    case 'right':
      return { x: area.x + area.width - size.width, y, ...size };
    case 'top':
      return { x, y: area.y, ...size };
    default:
      return { x, y: area.y + area.height - size.height, ...size };
  }
}

// Keep the panel where the orb is, but always fully on screen.
function panelBounds() {
  const area = workArea();
  const b = win.getBounds();
  return {
    x: clamp(b.x, area.x, area.x + area.width - PANEL.width),
    y: clamp(b.y, area.y, area.y + area.height - PANEL.height),
    ...PANEL,
  };
}

function enforceAlwaysOnTop() {
  if (!win || win.isDestroyed()) return;
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
}

function applyLayout() {
  if (mode === 'panel') {
    win.setBounds(panelBounds());
  } else if (dockEdge) {
    win.setBounds(dockedBounds(expanded ? ORB : nubSize()));
  } else {
    win.setBounds({ ...win.getBounds(), ...ORB });
  }
  enforceAlwaysOnTop();
  send();
}

function edgeNear(bounds) {
  const area = workArea();
  const distances = {
    left: bounds.x - area.x,
    right: area.x + area.width - (bounds.x + bounds.width),
    top: bounds.y - area.y,
    bottom: area.y + area.height - (bounds.y + bounds.height),
  };

  let best = null;
  for (const [edge, distance] of Object.entries(distances)) {
    if (distance <= DOCK_THRESHOLD && (best === null || distance < distances[best])) best = edge;
  }
  return best;
}

// Re-reads the orb's position and collapses it onto whichever edge it is resting
// against. Called after a drag, and again once the pointer has gone quiet.
function settleDock() {
  if (mode === 'panel') return;
  dockEdge = edgeNear(win.getBounds());
  expanded = false;
  applyLayout();
  saveState();
}

function send() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('state', { ...latest, mode, dockEdge, expanded, settings });
}

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  } catch {
    // Preferences are not worth interrupting the app over.
  }
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function saveState() {
  if (!win || win.isDestroyed()) return;
  // Panel bounds would be the wrong thing to restore, so record the orb's corner.
  const b = mode === 'panel' ? panelBounds() : win.getBounds();
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify({ x: b.x, y: b.y, dockEdge }));
  } catch {
    // Losing the position is not worth blocking a quit over.
  }
}

function createWindow() {
  const area = screen.getPrimaryDisplay().workArea;
  const saved = loadState();

  // A saved position can land off-screen if the display setup changed.
  const start = saved
    ? {
        x: clamp(saved.x, area.x, area.x + area.width - ORB.width),
        y: clamp(saved.y, area.y, area.y + area.height - ORB.height),
      }
    : {
        x: area.x + area.width - ORB.width - 40,
        y: area.y + Math.round(area.height / 3),
      };

  dockEdge = saved?.dockEdge ?? null;

  win = new BrowserWindow({
    ...ORB,
    ...start,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    minWidth: 1,
    minHeight: 1,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js') },
  });

  enforceAlwaysOnTop();

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Fires while the window still exists, unlike before-quit, which runs after
  // a window-close has already destroyed it.
  win.on('close', saveState);

  // Clicking away from the panel returns to the orb.
  win.on('blur', closePanel);

  // Keep topmost state resilient across visibility / restore events
  win.on('show', enforceAlwaysOnTop);
  win.on('restore', enforceAlwaysOnTop);
  win.on('minimize', () => win.restore());

  // Restores the docked layout when the saved state had the orb on an edge.
  win.webContents.on('did-finish-load', () => {
    applyLayout();
    enforceAlwaysOnTop();
  });
}

// Returns the window to the orb's old spot and lets it settle back onto its
// edge, so closing the panel leaves things exactly as they were found.
function closePanel() {
  if (mode !== 'panel') return;
  mode = 'orb';
  if (orbBounds) win.setBounds(orbBounds);
  orbBounds = null;
  settleDock();
}

function openPanel() {
  orbBounds = win.getBounds();
  mode = 'panel';
  win.focus();
  applyLayout();
}

/* ---------- Dragging ---------- */

// A drag follows the cursor from a timer here rather than from the renderer's
// pointer events. Those events are no guide to where the pointer is: their
// coordinates are relative to a window that is itself moving, and Chromium goes
// on firing them at a perfectly still cursor for as long as the window is being
// repositioned. The OS cursor is the only honest signal, and only the main
// process can read it.
//
// Every tick recomputes the position from the press — origin plus total cursor
// travel — instead of nudging the window along. Nothing accumulates: a still
// cursor resolves to the same position however many ticks pass over it, so the
// orb cannot creep away from a held pointer.
function followCursor() {
  if (!drag || !win || win.isDestroyed()) return stopFollowing();

  const p = screen.getCursorScreenPoint();
  const dx = p.x - drag.cursor.x;
  const dy = p.y - drag.cursor.y;

  if (!drag.moved) {
    if (Math.hypot(dx, dy) <= CLICK_SLOP) return;
    drag.moved = true;
    // Leave the edge at full size before the orb starts following the pointer.
    // The corner it was pinned to stays the origin, so the delta still measures
    // from where the press happened.
    if (dockEdge) {
      dockEdge = null;
      expanded = false;
      win.setBounds({ ...drag.origin, ...ORB });
      send();
    }
  }

  const x = Math.round(drag.origin.x + dx);
  const y = Math.round(drag.origin.y + dy);
  if (x === drag.x && y === drag.y) return;
  drag.x = x;
  drag.y = y;

  // The size is restated on every move, and setPosition is avoided, because
  // setPosition reuses the size it reads back from the window. On a display at
  // a fractional scale that size does not survive the round trip through device
  // pixels: it comes back a pixel larger each time, and the window inflates from
  // under a top-left corner that never moves. The orb is centred in the window,
  // so it would slide out from under the pointer a pixel per move and keep going
  // for as long as the button was held.
  win.setBounds({ x, y, ...ORB });
}

function stopFollowing() {
  clearInterval(dragTick);
  dragTick = null;
}

ipcMain.on('drag-start', () => {
  stopFollowing();
  drag = { origin: win.getBounds(), cursor: screen.getCursorScreenPoint(), moved: false };
  dragTick = setInterval(followCursor, DRAG_FRAME_MS);
});

// Releasing the button is the only thing that ends a drag. However long the
// pointer is held still, the orb stays under it.
ipcMain.on('drag-end', () => {
  stopFollowing();
  const wasDrag = drag?.moved;
  drag = null;
  if (wasDrag) settleDock();
  else openPanel();
});

/* ---------- Other renderer requests ---------- */

// Clicking the collapsed nub is what opens the orb; hovering only lights it.
ipcMain.on('expand', () => {
  if (!dockEdge || mode === 'panel') return;
  expanded = true;
  applyLayout();
});

ipcMain.on('settle-dock', settleDock);

ipcMain.on('close-panel', closePanel);

ipcMain.on('set-setting', (_e, key, value) => {
  if (!(key in DEFAULT_SETTINGS)) return;
  settings = { ...settings, [key]: value };
  saveSettings();
  send();
});

ipcMain.on('open-claude-usage', () => shell.openExternal('https://claude.ai/settings/usage'));

ipcMain.handle('statusline-status', () => statusline.status());
ipcMain.handle('statusline-install', () => statusline.install());
ipcMain.handle('statusline-uninstall', () => statusline.uninstall());

ipcMain.handle('autostart-status', () => autostart.status());
ipcMain.handle('autostart-set', (_e, enabled) => autostart.set(enabled));

ipcMain.on('quit', () => app.quit());

// A second launch — two auto-start mechanisms both firing, a stray double-click
// — would otherwise spin up a second full orb with nothing to tell them apart.
// Losing the lock quits before any window or poller starts; holding it means any
// later launch attempt is handed off here instead of becoming its own instance.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win || win.isDestroyed()) return;
    win.show();
    win.focus();
    enforceAlwaysOnTop();
  });

  app.whenReady().then(() => {
    settings = loadSettings();
    statusline.refresh();
    createWindow();
    tray.init(win);
    providers.start((next) => {
      latest = next;
      send();
      tray.update(next);
      enforceAlwaysOnTop();
    });
  });

  app.on('window-all-closed', () => app.quit());
}
