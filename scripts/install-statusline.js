'use strict';

// Registers scripts/statusline.js as the global Claude Code status line.
// Run with --uninstall to remove it again.

const fs = require('fs');
const os = require('os');
const path = require('path');

const SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
const SCRIPT = path.join(__dirname, 'statusline.js');
const COMMAND = `node "${SCRIPT.replace(/\\/g, '/')}"`;

const uninstall = process.argv.includes('--uninstall');
const force = process.argv.includes('--force');

const settings = fs.existsSync(SETTINGS) ? JSON.parse(fs.readFileSync(SETTINGS, 'utf8')) : {};
const existing = settings.statusLine;

if (uninstall) {
  if (!existing) {
    console.log('No statusLine configured. Nothing to do.');
    process.exit(0);
  }
  if (existing.command !== COMMAND && !force) {
    console.error('statusLine belongs to something else. Re-run with --force to remove it anyway:');
    console.error(`  ${existing.command}`);
    process.exit(1);
  }
  delete settings.statusLine;
  write(settings);
  console.log(`Removed statusLine from ${SETTINGS}`);
  process.exit(0);
}

// Never silently replace a status line the user set up themselves.
if (existing && existing.command !== COMMAND && !force) {
  console.error('A different statusLine is already configured:');
  console.error(`  ${existing.command}`);
  console.error('Re-run with --force to replace it.');
  process.exit(1);
}

settings.statusLine = { type: 'command', command: COMMAND };
write(settings);

console.log(`Installed statusLine into ${SETTINGS}`);
console.log(`  ${COMMAND}`);
console.log('');
console.log('Restart Claude Code, then send one message: rate_limits only appears');
console.log('after the first API response of a session.');

function write(next) {
  fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
  fs.writeFileSync(SETTINGS, JSON.stringify(next, null, 2) + '\n');
}
