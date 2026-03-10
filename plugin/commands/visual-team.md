---
description: "Open the Claude Visual Team real-time dashboard"
argument-hint: ""
---

When the user runs `/visual-team`, do the following:

1. Check if the server is running by trying to reach `http://localhost:4800`
2. If not running, start it with: `node "${CLAUDE_PLUGIN_ROOT}/scripts/start-server.cjs"`
3. Tell the user to open `http://localhost:4800` in their browser
4. Provide a brief status: number of active sessions, connected agents, etc.

The dashboard shows:
- **Agent Graph**: Visual tree of orchestrator → subagent relationships
- **Activity Feed**: Real-time log of agent actions, tool calls, and results
- **Timeline**: Horizontal timeline with event markers
- **Stats**: Token usage, tool call counts, and duration
