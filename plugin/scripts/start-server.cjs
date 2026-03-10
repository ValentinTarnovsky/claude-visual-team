#!/usr/bin/env node
'use strict';

const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = parseInt(process.env.VISUAL_TEAM_PORT || '4800', 10);
const PID_FILE = path.join(os.homedir(), '.claude', 'visual-team.pid');

function checkServer() {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${PORT}/health`, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => { req.destroy(); resolve(false); });
  });
}

async function main() {
  const running = await checkServer();
  if (running) {
    process.exit(0);
  }

  // Kill stale process if PID file exists
  try {
    const oldPid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
    if (oldPid) {
      try { process.kill(oldPid, 'SIGTERM'); } catch (_) {}
    }
  } catch (_) {}

  const serverScript = path.join(__dirname, 'server.cjs');
  const child = spawn(process.execPath, [serverScript], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, VISUAL_TEAM_PORT: String(PORT) },
    windowsHide: true,
  });

  // Write PID for future cleanup
  try {
    fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
    fs.writeFileSync(PID_FILE, String(child.pid));
  } catch (_) {}

  child.unref();
  process.exit(0);
}

main().catch(() => process.exit(0));
