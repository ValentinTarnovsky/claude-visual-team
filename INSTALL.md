# Claude Visual Team — Installation Guide

## Prerequisites

- Node.js 18+
- Claude Code CLI installed and configured

## Install

### 1. Install dependencies

```bash
cd claude-visual-team
npm install
```

### 2. Copy plugin to Claude's cache

```bash
mkdir -p ~/.claude/plugins/cache/ValentinTarnovsky/claude-visual-team/1.0.0
cp -r ./. ~/.claude/plugins/cache/ValentinTarnovsky/claude-visual-team/1.0.0/
```

### 3. Register the plugin

Add to `~/.claude/plugins/installed_plugins.json` inside `"plugins"`:

```json
"claude-visual-team@ValentinTarnovsky": [
  {
    "scope": "user",
    "installPath": "C:\\Users\\tarno\\.claude\\plugins\\cache\\ValentinTarnovsky\\claude-visual-team\\1.0.0",
    "version": "1.0.0",
    "installedAt": "2026-03-10T19:30:00.000Z",
    "lastUpdated": "2026-03-10T19:30:00.000Z"
  }
]
```

### 4. Enable the plugin

Add to `~/.claude/settings.json` inside `"enabledPlugins"`:

```json
"claude-visual-team@ValentinTarnovsky": true
```

### 5. Restart Claude Code

Close and reopen Claude Code. The `SessionStart` hook will automatically launch the dashboard server.

## Usage

### Automatic

The server starts automatically when you open a Claude Code session. Open your browser at:

```
http://localhost:4800
```

### Manual

If you need to start the server manually:

```bash
node ~/.claude/plugins/cache/ValentinTarnovsky/claude-visual-team/1.0.0/scripts/start-server.cjs
```

### Slash Command

Inside Claude Code, run `/visual-team` to check the dashboard status.

## Verify

1. Open a Claude Code session
2. Open `http://localhost:4800` in your browser
3. Use the `Agent` tool (spawn subagents) — they'll appear in the dashboard in real-time

## Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `VISUAL_TEAM_PORT` | `4800` | Dashboard server port |
| `NODE_ENV` | — | Set to `development` for hot-reload of the HTML |

## Uninstall

1. Remove `"claude-visual-team@ValentinTarnovsky": true` from `~/.claude/settings.json`
2. Remove the entry from `~/.claude/plugins/installed_plugins.json`
3. Kill the server and clean up:

```bash
kill $(cat ~/.claude/visual-team.pid)
rm ~/.claude/visual-team.pid
rm -rf ~/.claude/plugins/cache/ValentinTarnovsky/claude-visual-team/
```
