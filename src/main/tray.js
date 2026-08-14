'use strict';

const { app, Menu, Tray } = require('electron');
const autostart = require('./autostart');

// A transparent, frameless, taskbar-less window that fades to 42% opacity leaves
// nothing on screen to say the app is running. The tray icon is that evidence,
// and its tooltip carries the same figure the orb is showing.

let tray = null;
let win = null;
// Held so the first reading, which can arrive before the icon has loaded, still
// reaches the tooltip rather than waiting out a poll for the next one.
let hint = 'Usage Monitor';

function tooltip(latest) {
  const m = latest.highest;
  if (!m) return 'Usage Monitor — 尚無資料';
  const reading = `${m.label} ${Math.round(m.usedPct)}%`;
  return `Usage Monitor\n${m.stale ? `${reading}（資料已過期）` : reading}`;
}

function toggleWindow() {
  if (win.isVisible()) win.hide();
  else win.show();
}

// Built on every right-click rather than cached: both the show/hide label and the
// auto-start checkbox track state that moves, and rebuilding is cheaper than
// finding every place that would have to remember to refresh a cached menu.
function buildMenu() {
  const auto = autostart.status();

  return Menu.buildFromTemplate([
    { label: win.isVisible() ? '隱藏' : '顯示', click: toggleWindow },
    { type: 'separator' },
    {
      label: '開機時自動啟動',
      type: 'checkbox',
      enabled: auto !== 'unavailable',
      checked: auto === 'enabled',
      click: (item) => autostart.set(item.checked),
    },
    { type: 'separator' },
    { label: '結束', click: () => app.quit() },
  ]);
}

// The icon is read off the executable rather than kept as an asset of its own,
// so the tray, the taskbar and the installer can never drift apart: whatever
// icon the build carries is the one that shows up here.
function init(window) {
  win = window;
  return app.getFileIcon(process.execPath, { size: 'normal' }).then((icon) => {
    // Held at module scope: a garbage-collected Tray takes its icon with it.
    tray = new Tray(icon);
    tray.setToolTip(hint);
    tray.on('click', toggleWindow);
    tray.on('right-click', () => tray.popUpContextMenu(buildMenu()));
  });
}

function update(latest) {
  hint = tooltip(latest);
  if (tray) tray.setToolTip(hint);
}

module.exports = { init, update };
