# Agent guide: Jarvis OS

This file is for AI coding agents (Claude Code, Codex, Cursor and others). It tells you how to set up, run and change this project. Human docs are in README.md.

## What this is

A local web dashboard for Claude Code data. `node server.js` serves `public/` and a JSON API on 127.0.0.1. It reads the user's Claude folder (default `~/.claude`) and does not change it, except when the user runs or adds a skill, or archives one (moves it to `skills/.archive`) from the Skills page.

## When the user asks you to set it up

The user may say "Set up Jarvis OS for me", or paste the GitHub link of this repo. Do these steps in order. Keep it short and friendly: the user may not be a developer. Ask before each step that writes outside the app folder.

1. **Get the code**: if the current folder has no `server.js`, you are not in the app yet. Ask the user which folder to install into (suggest `jarvis-os` in their home folder), then `git clone <repo link> <folder>` and work in that folder from now on. If `git` is missing, tell the user to download the ZIP from the GitHub page (Code, Download ZIP), unzip it, and tell you the folder.
2. **Node**: run `node --version`. Version 24 or newer is required. If it is missing or old, tell the user to install the LTS version from nodejs.org, then continue. Do not install it yourself.
3. **Claude folder**: check that `~/.claude/projects` exists (on Windows `%USERPROFILE%\.claude\projects`). If it does not, ask whether the user keeps Claude Code data somewhere else; if so, they must set `CLAUDE_CONFIG_DIR` to that folder before they start the server.
4. **Questions**: ask all of these in one message (or with your question tool), each with its default, so the user can reply "use the defaults":
   - Show the demo first, with invented data? Default: no.
   - Name in the top bar (`name`). Default: `Jarvis OS`.
   - Prefix to cut from project names (`trimPrefixes`). Look at the folder names in `~/.claude/projects`, find the common prefix (for example `C--Users-<name>-`) and suggest it. Default: your suggestion.
   - Folders with HTML outputs or documents to list on the Apps page (`artifactDirs`), and folders of single-file HTML apps (`microAppDirs`). Full paths. Default: none.
   - Extra git repos for the setup sync chip (`gitRepos`). Full paths. Default: none.
   - Permission mode for skills run from the app (`permissionMode`): `plan` (safest, read-only), `default` or `acceptEdits`. Default: `plan`.
   - Windows only: start the dashboard when you log in? Default: no.
5. **Demo** (if asked): start `node server.js --demo --port=4319` in the background, give the user http://127.0.0.1:4319, and stop it when they are done.
6. **Config**: copy `config.example.json` to `config.json` in the app folder and fill in the answers. Leave `limits` as they are; the user can change them on Home with "Edit limits". Never commit `config.json`; it is in `.gitignore`.
7. **Run**: if the user chose autostart, run `powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1` (it also starts the server now; undo with `scripts\uninstall-autostart.ps1`). Otherwise start `node server.js` in the background. If port 4317 is busy, use `--port=N`. Check that http://127.0.0.1:4317 answers (for example `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4317/` gives 200).
8. **Finish**: give the user:
   - The link http://127.0.0.1:4317 (the first load reads all sessions and can take a few seconds).
   - How to start it again later: `node server.js` in the app folder.
   - Three tips: number keys `1` to `8` change pages, `Ctrl+K` opens the command palette, and **Display** in the top bar turns on the 3D HUD view and interface sounds.
9. **Calendar** (optional, only if the user asks): the user pastes their own iCal address on the Planner page. Do not ask them to paste it to you, and never write it to a file you will commit or show it in chat. It is a secret.

## Rules for changing the code

- No npm dependencies and no build step. Use the Node standard library and plain browser JavaScript.
- Server code: `server.js` and `lib/`. Routes are split into `lib/routes-*.js`. Browser code: `public/`.
- The server must stay bound to 127.0.0.1 with the Host check in `server.js`. Do not remove it.
- Paths to user data come from `lib/scan.js` (`HOME` for the Claude folder, `DATA` for app state). Do not hard-code `~/.claude` or user paths.
- Logic in `lib/X.js` is tested in `lib/X.test.js`; add or update one when you change logic. Run the tests you touch: `node lib/X.test.js`. Run all: `for f in lib/*.test.js; do node "$f" || echo "FAIL $f"; done`.
- UI: keep keyboard access, visible focus rings, and the Display settings (reduce motion, high contrast, readable font) working. New animation must stop when `html[data-motion=reduce]` is set or `prefers-reduced-motion` matches.
- Check UI changes in demo mode (`node server.js --demo`) so you do not read or show the user's real data in screenshots.
- Do not use em dashes in copy, comments or docs.

## Files

| Path | What it holds |
|---|---|
| `server.js` | HTTP server, static files, skill runs (`claude -p`) |
| `lib/scan.js` | Data roots and the Claude folder scan |
| `lib/cost.js` | Token prices and usage windows |
| `lib/planner.js` | Planner storage and the iCal reader |
| `public/index.html` | Page shell, Home and Brain |
| `public/shell.js` | Navigation, command palette, Display settings |
| `scripts/make-demo.js` | Fake data for `--demo` |
| `config.example.json` | Example config; copy to `config.json` |
