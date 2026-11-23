// Regressions from the Gemini Neon High review of v0.1 (see git log).
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-reg-'));
process.env.TANDEM_HOME = tmp;
const { classifyFailure, lastJsonLine } = await import('../src/agents.js');
const { parseArgs } = await import('../src/cli.js');
const { setConfigValue, deepMerge } = await import('../src/config.js');
const { readRecords, summarize, ledgerPath } = await import('../src/ledger.js');
const { route } = await import('../src/router.js');
const { runCases } = await import('../src/bench/tasks.js');
const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'tandem.js');

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('review regressions', () => {
  it('429 inside a pid or id is not a quota error', () => {
    assert.equal(classifyFailure('worker pid 14290 exited'), 'error');
    assert.equal(classifyFailure('HTTP 429'), 'quota');
  });

  it('lastJsonLine ignores non-object JSON', () => {
    assert.equal(lastJsonLine('429'), null);
    assert.equal(lastJsonLine('[]\ntrue'), null);
  });

  it('--edit=false is false, junk is rejected', () => {
    assert.equal(parseArgs(['--edit=false']).flags.edit, false);
    assert.throws(() => parseArgs(['--edit=nope']));
  });

  it('config refuses prototype keys and coerces numbers strictly', () => {
    assert.throws(() => setConfigValue('__proto__.polluted', '1'));
    assert.throws(() => setConfigValue('a.constructor.b', '1'));
    assert.equal(setConfigValue('x.y', '   '), '   ');
    assert.equal(setConfigValue('x.z', 'Infinity'), 'Infinity');
    assert.equal({}.polluted, undefined);
    assert.equal(deepMerge({}, JSON.parse('{"__proto__":{"evil":1}}')).evil, undefined);
  });

  it('ledger skips non-object lines; prototype-named keys aggregate safely', () => {
    const rec = { ts: new Date().toISOString(), from: 'user', to: 'gemini', model: 'constructor', status: 'ok', usage: { total: 1 } };
    fs.writeFileSync(ledgerPath(), `null\n42\n"str"\n{"no":"ts"}\n${JSON.stringify(rec)}\n`);
    const recs = readRecords();
    assert.equal(recs.length, 1);
    const s = summarize(recs, { budgets: { geminiWeeklyCalls: 0 }, subscriptions: {} });
    assert.equal(s.byModel.constructor.calls, 1);
    assert.equal(s.budget.geminiWeek.ratio, 1, 'cap 0 means exhausted');
  });

  it('router honours the Gemini weekly cap and keeps pick when both pools are out', () => {
    assert.equal(route('write unit tests', { geminiWeek: { ratio: 1 } }).agent, 'claude');
    const both = route('write unit tests', { geminiWeek: { ratio: 1 }, claudeWeek: { ratio: 1 } });
    assert.equal(both.agent, 'gemini');
    assert.match(both.notes.join(' '), /Both/);
  });

  it('bench sandbox runs out of process', () => {
    const [r] = runCases('', ['process.pid']);
    assert.ok(r.ok);
    assert.notEqual(r.value, process.pid);
  });

  it('bench sandbox times out runaway code', () => {
    assert.throws(() => runCases('while (true) {}', ['1'], 1500), /timed out/);
  });

  it('mcp answers invalid requests instead of crashing', async () => {
    const child = spawn(process.execPath, [BIN, 'mcp'], { env: { ...process.env, TANDEM_HOME: tmp } });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stdin.write('null\n[1]\n{"jsonrpc":"2.0","id":7,"method":"tools/call","params":null}\n{"jsonrpc":"2.0","id":8,"method":"ping"}\n');
    await new Promise((r) => setTimeout(r, 800));
    child.kill();
    const msgs = out.trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(msgs.filter((m) => m.error?.code === -32600).length, 2);
    assert.ok(msgs.find((m) => m.id === 7));
    assert.deepEqual(msgs.find((m) => m.id === 8).result, {});
  });
});
