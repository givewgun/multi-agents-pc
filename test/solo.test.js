import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { soloState, soloBlock } from '../src/config.js';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'tandem.js');
const NOW = Date.parse('2026-11-23T12:00:00Z');

describe('soloState / soloBlock', () => {
  it('is off by default and with no config', () => {
    assert.deepEqual(soloState({}), { on: false, until: null });
    assert.equal(soloBlock({ solo: { on: false, until: null } }), null);
  });

  it('is on without an end time', () => {
    assert.deepEqual(soloState({ solo: { on: true, until: null } }, NOW), { on: true, until: null });
    assert.match(soloBlock({ solo: { on: true } }, NOW), /solo mode is on: .*do the work yourself/i);
  });

  it('expires at `until`', () => {
    const cfg = { solo: { on: true, until: '2026-11-23T13:00:00.000Z' } };
    assert.deepEqual(soloState(cfg, NOW), { on: true, until: '2026-11-23T13:00:00.000Z' });
    assert.match(soloBlock(cfg, NOW), /until 2026-11-23T13:00:00.000Z/);
    assert.equal(soloState(cfg, Date.parse('2026-11-23T13:00:01Z')).on, false);
    assert.equal(soloBlock(cfg, Date.parse('2026-11-23T13:00:01Z')), null);
  });
});

describe('tandem solo (CLI + MCP)', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-solo-'));
  const env = { ...process.env, TANDEM_HOME: home };
  const cli = (...a) => spawnSync(process.execPath, [BIN, ...a], { env, encoding: 'utf8' });

  it('turns on with --for, blocks ask/run/review and team benches, then turns off', () => {
    assert.equal(cli('solo', 'on', '--for', '2h').status, 0);
    const s = JSON.parse(cli('solo', '--json').stdout);
    assert.equal(s.on, true);
    assert.ok(Date.parse(s.until) > Date.now() + 60 * 60_000);
    for (const args of [['ask', 'gemini', 'hi'], ['run', 'hi'], ['review'], ['bench', '--agentic', '--setups', 'claude-lead']]) {
      const r = cli(...args);
      assert.notEqual(r.status, 0, args.join(' '));
      assert.match(r.stderr, /solo mode is on/, args.join(' '));
    }
    assert.equal(cli('solo', 'off').status, 0);
    assert.equal(JSON.parse(cli('solo', '--json').stdout).on, false);
    assert.notEqual(cli('solo', 'bogus').status, 0);
  });

  it('MCP ask_gemini returns an error while solo is on; tandem_stats reports it', async () => {
    assert.equal(cli('solo', 'on').status, 0);
    const child = spawn(process.execPath, [BIN, 'mcp', '--expose', 'gemini'], { env });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    const msgs = [
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ask_gemini', arguments: { prompt: 'hi' } } },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'tandem_stats', arguments: {} } },
    ];
    child.stdin.write(msgs.map((m) => JSON.stringify(m)).join('\n') + '\n');
    try {
      const deadline = Date.now() + 10_000;
      while (out.trim().split('\n').filter(Boolean).length < 2 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
      const res = out.trim().split('\n').map((l) => JSON.parse(l));
      const ask = res.find((m) => m.id === 1).result;
      assert.equal(ask.isError, true);
      assert.match(ask.content[0].text, /solo mode is on/);
      const stats = JSON.parse(res.find((m) => m.id === 2).result.content[0].text);
      assert.equal(stats.solo.on, true);
    } finally {
      child.kill();
      cli('solo', 'off');
    }
  });
});
