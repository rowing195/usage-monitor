'use strict';

const { app } = require('electron');

// A stable exe path is the only thing this can point Windows at. A portable
// build re-unpacks into a fresh temp directory on every launch, and a dev
// checkout's electron.exe path moves with whoever cloned it — neither is
// something the registry Run key should be told to launch at login.
const available = app.isPackaged && !process.env.PORTABLE_EXECUTABLE_DIR;

function status() {
  if (!available) return 'unavailable';
  return app.getLoginItemSettings().openAtLogin ? 'enabled' : 'disabled';
}

function set(enabled) {
  if (available) app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath });
  return status();
}

module.exports = { status, set };
