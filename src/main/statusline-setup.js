'use strict';

// Installing Claude Code's status line has to work on a machine that never saw
// this repository, so the command written into ~/.claude/settings.json cannot
// point at a source checkout and cannot assume Node is on PATH.
//
// It points at a small .cmd shim instead. The shim holds the paths, which keeps
// settings.json stable while the app moves between installs, and gives somewhere
// to set ELECTRON_RUN_AS_NODE — Claude Code runs the command through cmd, which
// has no syntax for a per-command environment variable.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { scriptPath } = require('./resources');

const HOME = path.join(os.homedir(), '.usage-monitor');
const SHIM = path.join(HOME, 'statusline.cmd');
const SCRIPT = path.join(HOME, 'statusline.js');
const CLAUDE_SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
const COMMAND = `"${SHIM}"`;

// A portable build unpacks itself into a fresh temporary directory on every
// launch, so its executable is gone by the time Claude Code runs the status
// line. Only a real install can lend the app's own Node runtime; otherwise the
// shim has to fall back to whatever Node the machine has.
function runner() {
  return process.env.PORTABLE_EXECUTABLE_DIR ? 'node' : `"${process.execPath}"`;
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8'));
  } catch {
    return {};
  }
}

function writeSettings(next) {
  fs.mkdirSync(path.dirname(CLAUDE_SETTINGS), { recursive: true });
  fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(next, null, 2) + '\n');
}

// The status line script is copied out of the app rather than run from inside
// it, so the shim survives the app being moved, and so a portable build can
// install one at all.
function writeShim() {
  fs.mkdirSync(HOME, { recursive: true });
  fs.copyFileSync(scriptPath('statusline.js'), SCRIPT);
  fs.writeFileSync(SHIM, ['@echo off', 'set ELECTRON_RUN_AS_NODE=1', `${runner()} "${SCRIPT}"`, ''].join('\r\n'));
}

// 'absent' | 'installed' | 'foreign' — foreign meaning a status line the user
// set up themselves, which is never replaced without being asked twice.
function status() {
  const existing = readSettings().statusLine;
  if (!existing) return 'absent';
  return existing.command === COMMAND ? 'installed' : 'foreign';
}

function install() {
  writeShim();
  const settings = readSettings();
  settings.statusLine = { type: 'command', command: COMMAND };
  writeSettings(settings);
  return { status: status(), needsNode: runner() === 'node' };
}

function uninstall() {
  const settings = readSettings();
  delete settings.statusLine;
  writeSettings(settings);
  return { status: status(), needsNode: false };
}

// An app update ships a new status line script, and an install can move the
// executable the shim names. Both are corrected on launch, but only for a shim
// this app put there.
function refresh() {
  if (status() === 'installed') {
    try {
      writeShim();
    } catch {
      // A stale shim still runs; failing to refresh it is not worth a crash.
    }
  }
}

module.exports = { status, install, uninstall, refresh };
