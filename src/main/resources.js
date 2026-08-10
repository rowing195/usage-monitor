'use strict';

const path = require('path');
const { app } = require('electron');

// scripts/ is shipped outside the asar archive. PowerShell and the status line
// shim are separate processes that open these files by path, and nothing outside
// Electron can read a path that runs through app.asar.
const SCRIPTS_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'scripts')
  : path.join(__dirname, '..', '..', 'scripts');

module.exports = {
  scriptPath: (name) => path.join(SCRIPTS_DIR, name),
};
