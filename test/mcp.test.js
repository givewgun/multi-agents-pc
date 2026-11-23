import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION } from '../src/version.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const binPath = path.resolve(__dirname, '..', 'bin', 'tandem.js');

function startMcp(expose, tmpDir) {
  const child = spawn(process.execPath, [binPath, 'mcp', '--expose', expose], {
    env: { ...process.env, TANDEM_HOME: tmpDir },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let buf = '';
  const pending = new Map();

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pending.has(msg.id)) {
        const { resolve, timer } = pending.get(msg.id);
        clearTimeout(timer);
        pending.delete(msg.id);
        resolve(msg);
      }
    }
  });

  const request = (id, method, params = {}) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timeout waiting for response to ${method} (id=${id})`));
    }, 5000);
    pending.set(id, { resolve, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });

  const notify = (method, params = {}) => {
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  };

  return { child, request, notify };
}

describe('mcp server', () => {
  it('handles initialize, tools/list (--expose gemini), route_task, and unknown method', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-mcp-'));
    const { child, request, notify } = startMcp('gemini', tmpDir);

    try {
      const initRes = await request(1, 'initialize', { protocolVersion: '2025-11-25' });
      assert.equal(initRes.result.protocolVersion, '2025-11-25');
      assert.equal(initRes.result.serverInfo.version, VERSION);

      notify('notifications/initialized');

      const listRes = await request(2, 'tools/list');
      const names = listRes.result.tools.map((t) => t.name);
      assert.ok(names.includes('ask_gemini'));
      assert.ok(!names.includes('ask_claude'));
      assert.ok(names.includes('route_task'));

      const callRes = await request(3, 'tools/call', {
        name: 'route_task',
        arguments: { task: 'write unit tests for the router' },
      });
      assert.equal(callRes.result.isError, false);
      const routed = JSON.parse(callRes.result.content[0].text);
      assert.equal(routed.agent, 'gemini');

      const errRes = await request(4, 'unknown/method');
      assert.equal(errRes.error.code, -32601);
    } finally {
      child.kill();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('lists ask_claude and not ask_gemini when --expose claude', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-mcp-'));
    const { child, request } = startMcp('claude', tmpDir);

    try {
      await request(1, 'initialize', { protocolVersion: '2025-11-25' });
      const listRes = await request(2, 'tools/list');
      const names = listRes.result.tools.map((t) => t.name);
      assert.ok(names.includes('ask_claude'));
      assert.ok(!names.includes('ask_gemini'));
    } finally {
      child.kill();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
