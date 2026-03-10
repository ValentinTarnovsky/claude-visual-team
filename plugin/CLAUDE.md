# Claude Visual Team Plugin

Real-time visualization dashboard for Agent Teams on `http://localhost:4800`.

## How it works
- A file watcher monitors `~/.claude/projects/` for JSONL session files
- Parses agent spawn events, tool calls, and completions in real-time
- Serves a web dashboard with WebSocket updates on port 4800
- Auto-starts via SessionStart hook as a detached background process

## Commands
- `/visual-team` — Check status and open the dashboard
