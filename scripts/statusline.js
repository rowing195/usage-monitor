'use strict';

// Claude Code status line. Prints a line for the terminal, and hands the
// rate_limits payload to the floating orb by writing it to a file the app watches.
//
// This is the only sanctioned source for Claude quota percentages: hooks and
// OpenTelemetry do not carry them, and the desktop app never persists them.

const fs = require('fs');
const os = require('os');
const path = require('path');

const OUT = path.join(os.homedir(), '.usage-monitor', 'claude-statusline.json');

const GREY = '\x1b[90m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (raw += chunk));
process.stdin.on('end', () => {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return; // Never let a bad payload break the status line.
  }

  const limits = data.rate_limits;

  // rate_limits is absent until the first API response of a session, and absent
  // entirely for non-subscription accounts. Writing then would replace a good
  // reading with nothing; leaving the file alone lets it age into "stale" instead.
  if (limits) {
    try {
      fs.mkdirSync(path.dirname(OUT), { recursive: true });
      fs.writeFileSync(OUT, JSON.stringify({ rate_limits: limits, writtenAt: new Date().toISOString() }));
    } catch {
      // A failed write must not take the status line down with it.
    }
  }

  process.stdout.write(render(data, limits));
});

function colorFor(pct) {
  if (pct >= 90) return RED;
  if (pct >= 70) return YELLOW;
  return '';
}

function window(label, w) {
  if (!w || typeof w.used_percentage !== 'number') return null;
  const pct = Math.round(w.used_percentage);
  const color = colorFor(pct);
  return `${color}${label} ${pct}%${color ? RESET : ''}`;
}

function render(data, limits) {
  const parts = [];

  if (data.model?.display_name) parts.push(data.model.display_name);

  const dir = data.workspace?.current_dir || data.cwd;
  if (dir) parts.push(`${GREY}${path.basename(dir)}${RESET}`);

  const five = window('5h', limits?.five_hour);
  const seven = window('7d', limits?.seven_day);
  if (five) parts.push(five);
  if (seven) parts.push(seven);

  return parts.join(` ${GREY}·${RESET} `);
}
