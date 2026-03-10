#!/usr/bin/env node
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const chokidar = require('chokidar');
const WebSocket = require('ws');

const PORT = parseInt(process.env.VISUAL_TEAM_PORT || '4800', 10);
const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const DASHBOARD_PATH = path.join(__dirname, '..', 'ui', 'dashboard.html');

// ── State ──────────────────────────────────────────────────────────────────
const sessions = new Map();
const fileOffsets = new Map();
let dashboardHtml = '';
const IS_DEV = process.env.NODE_ENV === 'development';
const MAX_EVENTS = 1000;

try { dashboardHtml = fs.readFileSync(DASHBOARD_PATH, 'utf8'); } catch (_) {}

// ── Helpers ────────────────────────────────────────────────────────────────
function sessionIdFromPath(filePath) {
  const norm = filePath.replace(/\\/g, '/');
  // Pattern: projects/{encoded-project}/{sessionId}/...
  const m = norm.match(/projects\/([^/]+)\/([0-9a-f-]{36})\//);
  if (m) return { projectPath: m[1], sessionId: m[2] };
  return null;
}

function getOrCreateSession(sessionId, projectPath) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      sessionId,
      projectPath: decodeURIComponent(projectPath.replace(/--/g, '/')),
      startTime: Date.now(),
      agents: new Map(),
      events: [],
    });
  }
  return sessions.get(sessionId);
}

function agentIdFromPath(filePath) {
  const norm = filePath.replace(/\\/g, '/');
  const m = norm.match(/subagents\/(agent-[a-f0-9]+)/);
  return m ? m[1] : null;
}

function serializeSession(session) {
  return {
    sessionId: session.sessionId,
    projectPath: session.projectPath,
    startTime: session.startTime,
    agents: Object.fromEntries(session.agents),
    events: session.events.slice(-500),
  };
}

function getFullState() {
  const result = {};
  for (const [id, session] of sessions) {
    result[id] = serializeSession(session);
  }
  return result;
}

function pushEvent(session, evt) {
  session.events.push(evt);
  if (session.events.length > MAX_EVENTS) {
    session.events = session.events.slice(-MAX_EVENTS);
  }
}

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

// ── JSONL Parsing ──────────────────────────────────────────────────────────
function readNewLines(filePath) {
  const offset = fileOffsets.get(filePath) || 0;
  let stat;
  try { stat = fs.statSync(filePath); } catch (_) { return []; }
  if (stat.size <= offset) return [];

  const buf = Buffer.alloc(stat.size - offset);
  const fd = fs.openSync(filePath, 'r');
  fs.readSync(fd, buf, 0, buf.length, offset);
  fs.closeSync(fd);
  fileOffsets.set(filePath, stat.size);

  const text = buf.toString('utf8');
  const lines = text.split('\n').filter((l) => l.trim());
  const parsed = [];
  for (const line of lines) {
    try { parsed.push(JSON.parse(line)); } catch (_) {}
  }
  return parsed;
}

function processMainJsonl(filePath, entries) {
  const info = sessionIdFromPath(filePath);
  if (!info) return;
  const session = getOrCreateSession(info.sessionId, info.projectPath);

  for (const entry of entries) {
    // Detect Agent spawn: assistant message with Agent tool_use
    if (entry.type === 'assistant' && Array.isArray(entry.message?.content)) {
      for (const block of entry.message.content) {
        if (block.type === 'tool_use' && block.name === 'Agent') {
          const input = block.input || {};
          const agentKey = block.id || `agent-${Date.now()}`;
          const agentData = {
            id: agentKey,
            type: input.subagent_type || 'general-purpose',
            prompt: (input.prompt || '').slice(0, 200),
            description: input.description || '',
            status: 'running',
            toolCalls: [],
            tokens: 0,
            startTime: Date.now(),
            endTime: null,
          };
          session.agents.set(agentKey, agentData);
          const evt = {
            type: 'agent_spawn',
            agentId: agentKey,
            agentType: agentData.type,
            description: agentData.description,
            prompt: agentData.prompt,
            timestamp: Date.now(),
          };
          pushEvent(session, evt);
          broadcast({ type: 'event', sessionId: info.sessionId, event: evt });
        }
      }
    }

    // Detect Agent completion: tool_result for an Agent tool_use
    if (entry.type === 'tool_result' || (entry.type === 'user' && Array.isArray(entry.message?.content))) {
      const contents = entry.message?.content || (entry.content ? [entry] : []);
      for (const block of (Array.isArray(contents) ? contents : [])) {
        if (block.type === 'tool_result' && session.agents.has(block.tool_use_id)) {
          const agent = session.agents.get(block.tool_use_id);
          agent.status = 'completed';
          agent.endTime = Date.now();
          const evt = {
            type: 'agent_complete',
            agentId: block.tool_use_id,
            agentType: agent.type,
            duration: agent.endTime - agent.startTime,
            timestamp: Date.now(),
          };
          pushEvent(session, evt);
          broadcast({ type: 'event', sessionId: info.sessionId, event: evt });
        }
      }
    }

    // User messages
    if (entry.type === 'user' && entry.message?.content) {
      const text = typeof entry.message.content === 'string'
        ? entry.message.content
        : Array.isArray(entry.message.content)
          ? entry.message.content.map(b => b.text || '').join('')
          : '';
      if (text) {
        const evt = {
          type: 'user_message',
          text: text.slice(0, 300),
          timestamp: Date.now(),
        };
        pushEvent(session, evt);
        broadcast({ type: 'event', sessionId: info.sessionId, event: evt });
      }
    }
  }
}

function processSubagentJsonl(filePath, entries) {
  const info = sessionIdFromPath(filePath);
  const agentFileId = agentIdFromPath(filePath);
  if (!info || !agentFileId) return;
  const session = getOrCreateSession(info.sessionId, info.projectPath);

  for (const entry of entries) {
    // Tool uses by subagent
    if (entry.type === 'assistant' && Array.isArray(entry.message?.content)) {
      for (const block of entry.message.content) {
        if (block.type === 'tool_use') {
          // Find which session agent this subagent file belongs to
          let matchedAgent = null;
          for (const [, agent] of session.agents) {
            if (agent.subagentFileId === agentFileId) {
              matchedAgent = agent;
              break;
            }
          }
          if (!matchedAgent) {
            // Try to associate by file id
            for (const [, agent] of session.agents) {
              if (!agent.subagentFileId) {
                agent.subagentFileId = agentFileId;
                matchedAgent = agent;
                break;
              }
            }
          }

          const evt = {
            type: 'tool_call',
            agentFileId: agentFileId,
            agentId: matchedAgent?.id || agentFileId,
            agentType: matchedAgent?.type || 'unknown',
            toolName: block.name,
            toolInput: JSON.stringify(block.input || {}).slice(0, 200),
            timestamp: Date.now(),
          };
          pushEvent(session, evt);
          broadcast({ type: 'event', sessionId: info.sessionId, event: evt });

          if (matchedAgent) {
            matchedAgent.toolCalls.push({ name: block.name, time: Date.now() });
          }
        }
      }
    }

    // Tool results in subagent
    if (entry.type === 'tool_result' || (entry.type === 'user' && Array.isArray(entry.message?.content))) {
      const contents = entry.message?.content || [];
      for (const block of (Array.isArray(contents) ? contents : [])) {
        if (block.type === 'tool_result') {
          const resultText = typeof block.content === 'string'
            ? block.content
            : Array.isArray(block.content)
              ? block.content.map(b => b.text || '').join('')
              : '';
          const evt = {
            type: 'tool_result',
            agentFileId: agentFileId,
            toolUseId: block.tool_use_id,
            result: resultText.slice(0, 200),
            timestamp: Date.now(),
          };
          pushEvent(session, evt);
          broadcast({ type: 'event', sessionId: info.sessionId, event: evt });
        }
      }
    }
  }
}

function processMetaJson(filePath) {
  const info = sessionIdFromPath(filePath);
  const agentFileId = agentIdFromPath(filePath);
  if (!info || !agentFileId) return;

  try {
    const meta = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const session = getOrCreateSession(info.sessionId, info.projectPath);

    // Update agent info from meta
    for (const [, agent] of session.agents) {
      if (agent.subagentFileId === agentFileId || !agent.subagentFileId) {
        if (meta.type) agent.type = meta.type;
        if (meta.model) agent.model = meta.model;
        if (!agent.subagentFileId) agent.subagentFileId = agentFileId;
        break;
      }
    }

    broadcast({
      type: 'meta_update',
      sessionId: info.sessionId,
      agentFileId,
      meta,
    });
  } catch (_) {}
}

// ── HTTP Server ────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  if (req.url === '/api/state') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getFullState()));
    return;
  }

  // Serve dashboard (re-read only in dev for hot reload)
  if (IS_DEV) {
    try { dashboardHtml = fs.readFileSync(DASHBOARD_PATH, 'utf8'); } catch (_) {}
  }
  res.writeHead(200, {
    'Content-Type': 'text/html',
    'Cache-Control': 'no-cache',
  });
  res.end(dashboardHtml);
});

// ── WebSocket Server ───────────────────────────────────────────────────────
const wss = new WebSocket.Server({ server, path: '/ws' });

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'init', state: getFullState() }));
});

// ── File Watcher ───────────────────────────────────────────────────────────
function startWatcher() {
  if (!fs.existsSync(PROJECTS_DIR)) {
    fs.mkdirSync(PROJECTS_DIR, { recursive: true });
  }

  const watcher = chokidar.watch(
    [
      path.join(PROJECTS_DIR, '**', '*.jsonl'),
      path.join(PROJECTS_DIR, '**', '*.meta.json'),
    ],
    {
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
      depth: 6,
      usePolling: false,
    }
  );

  function handleFile(filePath) {
    const norm = filePath.replace(/\\/g, '/');

    if (norm.endsWith('.meta.json')) {
      processMetaJson(filePath);
      return;
    }

    if (!norm.endsWith('.jsonl')) return;

    const entries = readNewLines(filePath);
    if (entries.length === 0) return;

    if (norm.includes('/subagents/')) {
      processSubagentJsonl(filePath, entries);
    } else {
      processMainJsonl(filePath, entries);
    }
  }

  watcher.on('add', handleFile);
  watcher.on('change', handleFile);
  watcher.on('unlink', (filePath) => fileOffsets.delete(filePath));

  console.log(`[visual-team] Watching ${PROJECTS_DIR}`);
}

// ── Start ──────────────────────────────────────────────────────────────────
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[visual-team] Dashboard: http://localhost:${PORT}`);
  startWatcher();
});

// Graceful shutdown
process.on('SIGTERM', () => { server.close(); process.exit(0); });
process.on('SIGINT', () => { server.close(); process.exit(0); });
