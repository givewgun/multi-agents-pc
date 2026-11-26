import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { VERSION } from '../src/version.js';
import { saveThread, readThreads, threadKey, explicitThread, reuseNote } from '../src/mcp.js';
import { seedUsage } from './_usage-seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const binPath = path.resolve(__dirname, '..', 'bin', 'tandem.js');

function startMcp(expose, tmpDir) {
  seedUsage(tmpDir);
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

      // The lead's category is advertised as an enum and wins over keyword rules.
      for (const n of ['route_task', 'ask_gemini']) {
        const t = listRes.result.tools.find((x) => x.name === n);
        assert.ok(t.inputSchema.properties.category.enum.includes('research'), `${n} advertises category`);
      }
      const leadRes = await request(5, 'tools/call', {
        name: 'route_task',
        arguments: { task: 'need to mod skyrim and modify papyrus script of enb', category: 'research' },
      });
      const leadPick = JSON.parse(leadRes.result.content[0].text);
      assert.equal(leadPick.source, 'lead');
      assert.equal(leadPick.category, 'research');
      const badRes = await request(6, 'tools/call', { name: 'route_task', arguments: { task: 'x', category: 'bogus' } });
      assert.equal(badRes.result.isError, true);

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
      const askClaudeTool = listRes.result.tools.find((t) => t.name === 'ask_claude');
      assert.equal(askClaudeTool.inputSchema.properties.cwd.type, 'string');

      const badCwd = await request(3, 'tools/call', {
        name: 'ask_claude',
        arguments: { prompt: 'hello', cwd: path.join(tmpDir, 'does-not-exist') },
      });
      assert.equal(badCwd.result.isError, true);
      assert.match(badCwd.result.content[0].text, /not an existing directory/i);
    } finally {
      child.kill();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('scopes saved threads by explicit cwd', () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-home-'));
    const prevHome = process.env.TANDEM_HOME;
    process.env.TANDEM_HOME = tmpHome;
    try {
      const repoA = path.join(tmpHome, 'repo-a');
      const repoB = path.join(tmpHome, 'repo-b');
      saveThread('shared-slug', 'claude', 'sess-a', repoA);
      saveThread('shared-slug', 'claude', 'sess-b', repoB);
      const all = readThreads();
      assert.equal(all[threadKey('shared-slug', repoA)].claude, 'sess-a');
      assert.equal(all[threadKey('shared-slug', repoA)].cwd, path.resolve(repoA));
      assert.equal(all[threadKey('shared-slug', repoB)].claude, 'sess-b');
      assert.equal(all[threadKey('shared-slug', repoB)].cwd, path.resolve(repoB));
    } finally {
      if (prevHome === undefined) delete process.env.TANDEM_HOME;
      else process.env.TANDEM_HOME = prevHome;
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  it('queries client roots/list when capabilities.roots is advertised and cwd is omitted', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-roots-'));
    const fakeWorkspace = path.join(tmpDir, 'my-project');
    fs.mkdirSync(fakeWorkspace);
    // Point claude path to a nonexistent binary so callTool fails fast with `missing` while still recording ledger cwd.
    fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify({ paths: { claude: path.join(tmpDir, 'no-claude-bin') } }));

    const child = spawn(process.execPath, [binPath, 'mcp', '--expose', 'claude'], {
      env: { ...process.env, TANDEM_HOME: tmpDir, TANDEM_CLAUDE: '' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let buf = '';
    let rootsRequested = false;
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
        if (msg.method === 'roots/list') {
          rootsRequested = true;
          child.stdin.write(JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: { roots: [{ uri: pathToFileURL(fakeWorkspace).href, name: 'my-project' }] },
          }) + '\n');
          continue;
        }
        if (msg.id !== undefined && pending.has(msg.id)) {
          const { resolve, timer } = pending.get(msg.id);
          clearTimeout(timer);
          pending.delete(msg.id);
          resolve(msg);
        }
      }
    });

    const req = (id, method, params = {}) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timeout on ${method}`)), 5000);
      pending.set(id, { resolve, timer });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });

    try {
      await req(1, 'initialize', { protocolVersion: '2025-11-25', capabilities: { roots: {} } });
      const freshRes = await req(2, 'tools/call', { name: 'ask_claude', arguments: { prompt: 'hello', model: 'haiku' } });
      assert.equal(rootsRequested, true);
      const ledgerLines = fs.readFileSync(path.join(tmpDir, 'ledger.jsonl'), 'utf8').trim().split('\n');
      const rec = JSON.parse(ledgerLines.at(-1));
      assert.equal(rec.project, 'my-project');
      assert.equal(rec.thread, null);
      assert.equal(fs.existsSync(path.join(tmpDir, 'threads.json')), false);
      assert.match(freshRes.result.content[0].text, /fresh session/);
      assert.doesNotMatch(freshRes.result.content[0].text, /thread mcp-/);

      const threadedRes = await req(3, 'tools/call', { name: 'ask_claude', arguments: { prompt: 'hello', model: 'haiku', thread: 'review-1' } });
      const ledgerLines2 = fs.readFileSync(path.join(tmpDir, 'ledger.jsonl'), 'utf8').trim().split('\n');
      const rec2 = JSON.parse(ledgerLines2.at(-1));
      assert.equal(rec2.thread, 'review-1');
      assert.match(threadedRes.result.content[0].text, /thread review-1/);
    } finally {
      child.kill();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('explicitThread accepts safe non-empty strings and rejects empty/unsafe/non-strings', () => {
    assert.equal(explicitThread(undefined), null);
    assert.equal(explicitThread(''), null);
    assert.equal(explicitThread('  '), null);
    assert.equal(explicitThread('__proto__'), null);
    assert.equal(explicitThread('constructor'), null);
    assert.equal(explicitThread('prototype'), null);
    assert.equal(explicitThread(null), null);
    assert.equal(explicitThread(123), null);
    assert.equal(explicitThread({}), null);
    assert.equal(explicitThread(' slug '), 'slug');
    assert.equal(explicitThread('review-1'), 'review-1');
  });

  it('reuseNote formats reused context and cache percentage per agent semantics', () => {
    assert.equal(reuseNote('claude', { input: 122000, cacheRead: 112000 }, false), '');
    assert.equal(reuseNote('claude', { input: 122000, cacheRead: 112000 }, true), 'resumed: 122k input · 92% cached');
    assert.equal(reuseNote('gemini', { input: 181000, cacheRead: 835000 }, true), 'resumed: 1016k input · 82% cached');
    assert.equal(reuseNote('claude', { input: 600, cacheRead: 300 }, true), 'resumed: 600 input · 50% cached');
    assert.equal(reuseNote('claude', { input: 0, cacheRead: 0 }, true), '');
    assert.equal(reuseNote('gemini', { input: 0, cacheRead: 0 }, true), '');
    assert.equal(reuseNote('claude', null, true), '');
  });
});
