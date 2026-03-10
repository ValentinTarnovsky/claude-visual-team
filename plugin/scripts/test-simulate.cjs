#!/usr/bin/env node
'use strict';

/**
 * Simulates a Claude Code agent team session by writing JSONL files
 * in the same format that Claude Code produces.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const SESSION_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const PROJECT_KEY = 'C--Users-tarno-Desktop-Valen-Claude-Visual-Team';
const BASE_DIR = path.join(os.homedir(), '.claude', 'projects', PROJECT_KEY, SESSION_ID);
const MAIN_JSONL = path.join(BASE_DIR, `${SESSION_ID}.jsonl`);
const SUBAGENT_DIR = path.join(BASE_DIR, 'subagents');

// Clean previous test data
fs.rmSync(BASE_DIR, { recursive: true, force: true });
fs.mkdirSync(SUBAGENT_DIR, { recursive: true });

function append(file, obj) {
  fs.appendFileSync(file, JSON.stringify(obj) + '\n');
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function simulate() {
  console.log('[test] Writing to:', MAIN_JSONL);

  // 1. User message
  append(MAIN_JSONL, {
    type: 'user',
    message: {
      content: 'Search the codebase for all API endpoints and create a plan to add rate limiting.'
    }
  });
  console.log('[test] User message written');
  await sleep(1500);

  // 2. Spawn Explore agent
  append(MAIN_JSONL, {
    type: 'assistant',
    message: {
      content: [
        {
          type: 'text',
          text: 'I\'ll search the codebase for API endpoints and then create a plan.'
        },
        {
          type: 'tool_use',
          id: 'toolu_explore_001',
          name: 'Agent',
          input: {
            subagent_type: 'Explore',
            description: 'Find API endpoints',
            prompt: 'Search the codebase for all API route definitions and endpoint handlers. Look for Express routes, REST endpoints, etc.'
          }
        }
      ]
    }
  });
  console.log('[test] Explore agent spawned');
  await sleep(2000);

  // 3. Explore agent tool calls (subagent JSONL)
  const exploreFile = path.join(SUBAGENT_DIR, 'agent-abc123.jsonl');

  // Write meta
  fs.writeFileSync(
    path.join(SUBAGENT_DIR, 'agent-abc123.meta.json'),
    JSON.stringify({ type: 'Explore', model: 'claude-sonnet-4-6' })
  );

  append(exploreFile, {
    type: 'assistant',
    message: {
      content: [
        { type: 'tool_use', id: 'tool_grep_1', name: 'Grep', input: { pattern: 'app\\.(get|post|put|delete)', path: 'src/' } }
      ]
    }
  });
  console.log('[test] Explore: Grep tool call');
  await sleep(1000);

  append(exploreFile, {
    type: 'user',
    message: {
      content: [
        { type: 'tool_result', tool_use_id: 'tool_grep_1', content: 'src/routes/api.js:15: app.get(\'/api/users\', ...)\nsrc/routes/api.js:28: app.post(\'/api/users\', ...)\nsrc/routes/api.js:45: app.delete(\'/api/users/:id\', ...)' }
      ]
    }
  });
  console.log('[test] Explore: Grep result');
  await sleep(1000);

  append(exploreFile, {
    type: 'assistant',
    message: {
      content: [
        { type: 'tool_use', id: 'tool_read_1', name: 'Read', input: { file_path: 'src/routes/api.js' } }
      ]
    }
  });
  console.log('[test] Explore: Read tool call');
  await sleep(1500);

  append(exploreFile, {
    type: 'user',
    message: {
      content: [
        { type: 'tool_result', tool_use_id: 'tool_read_1', content: '// API routes\nconst express = require(\'express\');\n...' }
      ]
    }
  });
  console.log('[test] Explore: Read result');
  await sleep(800);

  // 4. Explore agent completes
  append(MAIN_JSONL, {
    type: 'user',
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_explore_001',
          content: 'Found 3 API endpoints in src/routes/api.js: GET /api/users, POST /api/users, DELETE /api/users/:id'
        }
      ]
    }
  });
  console.log('[test] Explore agent completed');
  await sleep(1500);

  // 5. Spawn Plan agent
  append(MAIN_JSONL, {
    type: 'assistant',
    message: {
      content: [
        {
          type: 'text',
          text: 'Now let me create a plan for adding rate limiting.'
        },
        {
          type: 'tool_use',
          id: 'toolu_plan_002',
          name: 'Agent',
          input: {
            subagent_type: 'Plan',
            description: 'Plan rate limiting',
            prompt: 'Create an implementation plan for adding rate limiting to the 3 API endpoints found.'
          }
        }
      ]
    }
  });
  console.log('[test] Plan agent spawned');
  await sleep(2000);

  // 6. Plan agent tool calls
  const planFile = path.join(SUBAGENT_DIR, 'agent-def456.jsonl');

  fs.writeFileSync(
    path.join(SUBAGENT_DIR, 'agent-def456.meta.json'),
    JSON.stringify({ type: 'Plan', model: 'claude-opus-4-6' })
  );

  append(planFile, {
    type: 'assistant',
    message: {
      content: [
        { type: 'tool_use', id: 'tool_glob_1', name: 'Glob', input: { pattern: '**/middleware/*.js' } }
      ]
    }
  });
  console.log('[test] Plan: Glob tool call');
  await sleep(1200);

  append(planFile, {
    type: 'user',
    message: {
      content: [
        { type: 'tool_result', tool_use_id: 'tool_glob_1', content: 'src/middleware/auth.js\nsrc/middleware/cors.js' }
      ]
    }
  });
  console.log('[test] Plan: Glob result');
  await sleep(1500);

  // 7. Spawn Code agent (third, in parallel with plan completing)
  append(MAIN_JSONL, {
    type: 'assistant',
    message: {
      content: [
        {
          type: 'tool_use',
          id: 'toolu_code_003',
          name: 'Agent',
          input: {
            subagent_type: 'general-purpose',
            description: 'Implement rate limiter',
            prompt: 'Write the rate limiting middleware and integrate it into the API routes.'
          }
        }
      ]
    }
  });
  console.log('[test] Code agent spawned');
  await sleep(2000);

  // Code agent work
  const codeFile = path.join(SUBAGENT_DIR, 'agent-ghi789.jsonl');

  fs.writeFileSync(
    path.join(SUBAGENT_DIR, 'agent-ghi789.meta.json'),
    JSON.stringify({ type: 'general-purpose', model: 'claude-opus-4-6' })
  );

  append(codeFile, {
    type: 'assistant',
    message: {
      content: [
        { type: 'tool_use', id: 'tool_write_1', name: 'Write', input: { file_path: 'src/middleware/rateLimit.js', content: '...' } }
      ]
    }
  });
  console.log('[test] Code: Write tool call');
  await sleep(1000);

  append(codeFile, {
    type: 'user',
    message: {
      content: [
        { type: 'tool_result', tool_use_id: 'tool_write_1', content: 'File written successfully' }
      ]
    }
  });
  console.log('[test] Code: Write result');
  await sleep(800);

  append(codeFile, {
    type: 'assistant',
    message: {
      content: [
        { type: 'tool_use', id: 'tool_edit_1', name: 'Edit', input: { file_path: 'src/routes/api.js', old_string: 'app.get', new_string: 'app.get(rateLimit)' } }
      ]
    }
  });
  console.log('[test] Code: Edit tool call');
  await sleep(1200);

  append(codeFile, {
    type: 'user',
    message: {
      content: [
        { type: 'tool_result', tool_use_id: 'tool_edit_1', content: 'File edited successfully' }
      ]
    }
  });
  console.log('[test] Code: Edit result');
  await sleep(1000);

  append(codeFile, {
    type: 'assistant',
    message: {
      content: [
        { type: 'tool_use', id: 'tool_bash_1', name: 'Bash', input: { command: 'npm test' } }
      ]
    }
  });
  console.log('[test] Code: Bash tool call');
  await sleep(1500);

  append(codeFile, {
    type: 'user',
    message: {
      content: [
        { type: 'tool_result', tool_use_id: 'tool_bash_1', content: 'All 12 tests passed' }
      ]
    }
  });
  console.log('[test] Code: Bash result');
  await sleep(800);

  // 8. Plan completes
  append(MAIN_JSONL, {
    type: 'user',
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_plan_002',
          content: 'Plan: 1) Add express-rate-limit package. 2) Create middleware. 3) Apply to all routes.'
        }
      ]
    }
  });
  console.log('[test] Plan agent completed');
  await sleep(1500);

  // 9. Code agent completes
  append(MAIN_JSONL, {
    type: 'user',
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_code_003',
          content: 'Rate limiting implemented. Created src/middleware/rateLimit.js and updated all 3 endpoints. All tests pass.'
        }
      ]
    }
  });
  console.log('[test] Code agent completed');

  console.log('\n[test] Simulation complete! Check http://localhost:4800');
}

simulate().catch(console.error);
