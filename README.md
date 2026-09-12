<div align="center">

# Usage Monitor

**A floating orb for Windows that shows how much Claude and Antigravity quota you have left — before you run into the wall.**

[繁體中文版 README](README.zh-TW.md)

<img src="https://img.shields.io/badge/Electron-47848F.svg?style=flat-square&logo=Electron&logoColor=white" alt="Electron">
<img src="https://img.shields.io/badge/JavaScript-F7DF1E.svg?style=flat-square&logo=JavaScript&logoColor=black" alt="JavaScript">
<img src="https://img.shields.io/badge/Windows-0078D6.svg?style=flat-square&logo=Windows&logoColor=white" alt="Windows">
<img src="https://img.shields.io/badge/electron--builder-000000.svg?style=flat-square&logo=electron-builder&logoColor=white" alt="electron-builder">
<img src="https://img.shields.io/badge/npm-CB3837.svg?style=flat-square&logo=npm&logoColor=white" alt="npm">

</div>

---

## What this is

Usage Monitor is a small always-on-top desktop orb for Windows that tracks **remaining quota** — not token counts — for two tools:

- **Claude** (via Claude Code's status line, the only local source that actually exposes `rate_limits` percentages)
- **Google Antigravity** (via its local language-server API, polled every 60 seconds)

The orb's ring color tells you at a glance how close you are to a limit. Click it to open a panel with the exact numbers, reset countdowns, and per-source detail. Drag it to a screen edge and it docks into a slim, unobtrusive tab.

This project exists because "usage" dashboards that report token counts don't answer the question that actually matters mid-session: **how much room is left before I get cut off?** See [HANDOFF.md](HANDOFF.md) for the full research trail behind that distinction, including the API paths that were evaluated and rejected (notably the undocumented OAuth usage endpoint, which as of 2026-02-19 is a Consumer ToS violation for this exact use case).

## Features

- **Two quota sources, one glance.** Claude's 5-hour and 7-day rate-limit windows, plus Antigravity's pooled model quotas (11 models collapse into 2 real pools), ranked together on one 0–100 scale.
- **Synchronized Orb & Tab with Smart Lock.** The orb and docked tab stay in sync, displaying the tool you're actively using. While using Claude, if your 7-day weekly quota reaches ≥ 90%, it automatically locks to the 7-day metric with a red alert; switching to Antigravity seamlessly displays its active model pool.
- **Truly resilient always-on-top (Screen-saver tier).** High-priority topmost ranking and full-screen / multi-workspace support (`setVisibleOnAllWorkspaces`) with self-healing window lifecycle guards that survive focus shifts and Win+D.
- **Five looks, one switch.** A row at the top of the settings panel swaps the whole app between walnut (the default), glass, instrument, paper and phosphor — each option previews itself in its own materials. Switching is instant, and every look is a value swap on the same tokens, so the layout, the 70/90 thresholds and the staleness rules never move. The glass look is translucent rather than frosted: a transparent window has no backdrop for Chromium to blur.
- **Fluid morphing & spring physics.** Elastic spring overshoot on appearance, 3D hover highlights, smooth damped panel spring-in with staggered row fade-ins, animated numeric ticker, and elastic ring easing.
- **Breathing glow & urgency pulses.** Subtle 4s breathing glow during standby; soft pulsing alert waves automatically trigger at 70% (amber) and 90% (red) thresholds — in the looks that glow at all. Instrument lights the dial from within and colours the graduation the needle has passed; paper inverts the whole disc to solid ink instead, because print does not pulse.
- **60fps GPU hardware acceleration.** Full compositing layer isolation ensures buttery-smooth rendering with zero jank on Windows transparent windows.
- **Honest about stale data.** A reading past its freshness window turns grey and shows "as of HH:MM" instead of guessing — no interpolation, no fake precision.
- **Dock, don't clutter.** Drag to any screen edge to collapse into a small tab; hover lights it up, click reopens it.
- **Never running invisibly.** A tray icon in the notification area answers "is it actually on?" without hunting for a faded orb. Hover it for the tightest quota reading; left-click to show or hide the orb, right-click for the rest.
- **Launch at login.** One switch in the settings panel registers the app with Windows — installed builds only, since a portable build has no stable path to register.
- **Color-only alerts.** No popups, no notification spam — amber at 70%, red at 90%.
- **In-app Claude Code integration.** Install or remove the required status line straight from the settings panel — no manual JSON editing.
- **Antigravity without an extra CLI.** Talks directly to the local language server's Connect API; no dependency on the (slow, occasionally broken) `antigravity-usage` tool.

## How it works

```
Claude Code  ──status line──▶  ~/.usage-monitor/claude-statusline.json  ──▶  orb
Antigravity  ──local RPC, polled every 60s──▶  orb
```

Claude's percentage is only ever as fresh as your last message in Claude Code — the desktop app and other Claude surfaces don't feed it. Antigravity is polled independently and stays current on its own.

## Project structure

```
src/
├── main/
│   ├── index.js              window state machine, dragging, docking, IPC
│   ├── providers.js           the two data sources: fetch, normalize, staleness, ranking
│   ├── autostart.js           the launch-at-login registration behind the settings switch
│   ├── resources.js           resolves scripts/ path in dev vs. packaged builds
│   ├── statusline-setup.js    installs/removes the Claude Code status line from the app
│   └── tray.js                notification-area icon: tooltip, show/hide, context menu
├── preload.js                 contextBridge between main and renderer
└── renderer/
    ├── index.html             orb / docked tab / panel — three states, one page
    ├── renderer.js             rendering and interaction
    └── styles.css              theme and layout

scripts/
├── statusline.js               the Claude Code status line script itself
├── discover-antigravity.ps1    locates the Antigravity language server's port + CSRF token
└── install-statusline.js       legacy standalone installer (superseded by the in-app one)

start.vbs / start.bat           launchers with no lingering console window
```

Runtime state lives in `~/.usage-monitor/`: `claude-statusline.json`, `window-state.json`, `settings.json`, and (once installed) `statusline.cmd` / `statusline.js`.

## Getting started

### Prerequisites

- Windows 10 or 11
- A **Claude Pro or Max subscription account** signed into Claude Code — API-billing accounts never receive `rate_limits` data, so the Claude side of the orb will stay empty
- [Node.js](https://nodejs.org/) — only required if you build from source, or if you run the **portable** build and want the Claude status line to work (see note below)

**Option A — download a prebuilt build (recommended for regular use)**

Grab the latest `Usage Monitor <version> Setup.exe` (installer) or `Usage Monitor <version> Portable.exe` (no install step) from the [Releases page](https://github.com/rowing195/usage-monitor/releases).

- **Setup.exe**: per-user install, no admin rights needed, proper uninstall entry and desktop shortcut.
- **Portable.exe**: run directly, nothing installed. Because it unpacks itself into a new temp directory on every launch, the Claude status line integration (see below) falls back to your system's `node` instead of the app's own runtime — install Node.js first if you plan to use that build's status line feature.

**Option B — build it yourself**

```sh
git clone https://github.com/rowing195/usage-monitor.git
cd usage-monitor
npm install
npm run dist        # builds both the NSIS installer and the portable .exe
npm run dist:dir     # unpacked build only, for quick local testing
```

Output lands in `dist/`.

**Option C — run from source**

```sh
git clone https://github.com/rowing195/usage-monitor.git
cd usage-monitor
npm install
npm start
```

You do **not** need to package anything for day-to-day development — `npm start` runs directly against the source in `src/`. Packaging (Option A) is only for producing something to install or hand to someone else.

### Connecting the Claude side

Claude's percentages only exist locally through Claude Code's status line. Open the orb's panel → gear icon → **Claude statusline**, and click **Install**. Restart Claude Code and send one message — `rate_limits` only appears after the first API response of a session.

(The old way, `npm run install-statusline`, still exists but writes a different command into `~/.claude/settings.json` than the in-app installer does, so the two will show up as "belongs to something else" to each other. Prefer the in-app button.)

## Known limitations

- **The Claude side will often show grey.** If your main usage is the Claude desktop app rather than Claude Code, quota it burns won't show up until you next send a message in Claude Code — there's no compliant way around this (see HANDOFF.md for what was tried and rejected).
- **Windows only.** The window-docking math, drag handling, and Antigravity discovery script are all Windows-specific.
- **No code signing.** Windows SmartScreen will warn on first run of a downloaded build; choose "More info → Run anyway."
- **Launch at login is installed-builds-only.** A portable build re-unpacks into a fresh temp directory every launch, so there is no stable path to hand the registry — the switch is greyed out there, and in a dev checkout.
- **Windows 11 hides new tray icons.** The first launch tucks the icon into the overflow flyout behind the `^` chevron; drag it onto the taskbar to keep it in sight.

## License

[MIT](LICENSE)
