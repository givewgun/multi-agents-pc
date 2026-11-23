import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { modeState, soloBlock, modeContext } from '../src/config.js';
import { modeInjection, promptHookOutput, MODE_RESET } from '../src/hooks.js';
import { seedUsage } from './_usage-seed.js';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'tandem.js');
const NOW = Date.parse('2026-11-23T12:00:00Z');

describe('modeState / soloBlock / modeContext', () => {
  it('defaults to ask, treats unknown values as ask, and preserves ISO until', () => {
    assert.deepEqual(modeState({}, NOW), { mode: 'ask', until: null });
    assert.deepEqual(modeState({ mode: { value: 'ask', until: null } }, NOW), { mode: 'ask', until: null });
    assert.deepEqual(modeState({ mode: { value: 'bogus', until: '2026-11-23T13:00:00Z' } }, NOW), { mode: 'ask', until: null });
    assert.equal(soloBlock({ mode: { value: 'ask', until: null } }, NOW), null);
    assert.deepEqual(modeState({ mode: { value: 'free', until: '2026-11-23T13:00:00Z' } }, NOW), { mode: 'free', until: '2026-11-23T13:00:00.000Z' });
    assert.equal(soloBlock({ mode: { value: 'free', until: null } }, NOW), null);
  });

  it('handles solo without an end time and expires timed modes at until', () => {
    assert.deepEqual(modeState({ mode: { value: 'solo', until: null } }, NOW), { mode: 'solo', until: null });
    assert.match(soloBlock({ mode: { value: 'solo' } }, NOW), /solo mode is on: .*do the work yourself/i);

    const cfg = { mode: { value: 'solo', until: '2026-11-23T13:00:00Z' } };
    assert.deepEqual(modeState(cfg, NOW), { mode: 'solo', until: '2026-11-23T13:00:00.000Z' });
    assert.match(soloBlock(cfg, NOW), /until 2026-11-23T13:00:00.000Z/);
    assert.deepEqual(modeState(cfg, Date.parse('2026-11-23T13:00:00Z')), { mode: 'ask', until: null });
    assert.deepEqual(modeState(cfg, Date.parse('2026-11-23T13:00:01Z')), { mode: 'ask', until: null });
    assert.equal(soloBlock(cfg, Date.parse('2026-11-23T13:00:01Z')), null);
  });

  it('formats modeContext for free, solo, and ask', () => {
    const freeCfg = { mode: { value: 'free', until: null } };
    const claudeFree = modeContext(freeCfg, 'claude', NOW);
    assert.match(claudeFree, /use tandem freely/i);
    assert.match(claudeFree, /Gemini/);
    const geminiFree = modeContext(freeCfg, 'gemini', NOW);
    assert.match(geminiFree, /use tandem freely/i);
    assert.match(geminiFree, /Claude/);

    const soloCfg = { mode: { value: 'solo', until: '2026-11-23T13:00:00.000Z' } };
    assert.match(modeContext(soloCfg, 'claude', NOW), /do not call Gemini/i);
    assert.match(modeContext(soloCfg, 'gemini', NOW), /do not call Claude/i);

    assert.equal(modeContext({ mode: { value: 'ask', until: null } }, 'claude', NOW), null);
    assert.equal(modeContext({ mode: { value: 'ask', until: null } }, 'gemini', NOW), null);
  });
});

describe('modeInjection / promptHookOutput', () => {
  it('injects every turn for claude free, once per key for gemini free, and resets once on ask', () => {
    const freeCfg = { mode: { value: 'free', until: null } };
    const askCfg = { mode: { value: 'ask', until: null } };

    const c1 = modeInjection('claude', freeCfg, undefined, NOW);
    assert.equal(c1.key, 'free|');
    assert.match(c1.text, /use tandem freely/i);
    const c2 = modeInjection('claude', freeCfg, c1.key, NOW);
    assert.equal(c2.key, 'free|');
    assert.equal(c2.text, c1.text);

    const g1 = modeInjection('gemini', freeCfg, undefined, NOW);
    assert.equal(g1.key, 'free|');
    assert.match(g1.text, /use tandem freely/i);
    const g2 = modeInjection('gemini', freeCfg, g1.key, NOW);
    assert.equal(g2.key, 'free|');
    assert.equal(g2.text, null);

    assert.deepEqual(modeInjection('gemini', askCfg, undefined, NOW), { key: 'ask|', text: null });
    assert.deepEqual(modeInjection('claude', askCfg, undefined, NOW), { key: 'ask|', text: null });
    assert.deepEqual(modeInjection('gemini', askCfg, 'free|', NOW), { key: 'ask|', text: MODE_RESET });
    assert.deepEqual(modeInjection('gemini', askCfg, 'ask|', NOW), { key: 'ask|', text: null });
    assert.deepEqual(modeInjection('claude', askCfg, 'free|', NOW), { key: 'ask|', text: MODE_RESET });
    assert.deepEqual(modeInjection('claude', askCfg, 'ask|', NOW), { key: 'ask|', text: null });
  });

  it('formats promptHookOutput for claude and gemini', () => {
    const claudeOut = promptHookOutput('claude', 'hello');
    assert.ok(claudeOut.endsWith('\n'));
    assert.deepEqual(JSON.parse(claudeOut), {
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'hello' },
    });
    assert.equal(promptHookOutput('claude', null), '');

    const geminiOut = promptHookOutput('gemini', 'hello');
    assert.ok(geminiOut.endsWith('\n'));
    assert.deepEqual(JSON.parse(geminiOut), {
      injectSteps: [{ systemMessage: { systemMessage: 'hello' } }],
    });
    assert.equal(promptHookOutput('gemini', null), '{}\n');
  });
});

describe('tandem mode / solo (CLI + hooks + MCP)', () => {
  const home = seedUsage(fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-mode-')));
  after(() => fs.rmSync(home, { recursive: true, force: true }));

  const env = { ...process.env, TANDEM_HOME: home };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  delete env.TANDEM_MANAGED;

  const cli = (args, opts = {}) => spawnSync(process.execPath, [BIN, ...args], {
    env: opts.env ? { ...env, ...opts.env } : env,
    input: opts.input,
    encoding: 'utf8',
  });

  it('turns solo on with --for, blocks ask/run/review and team benches, then turns off', () => {
    assert.equal(cli(['solo', 'on', '--for', '2h']).status, 0);
    const s = JSON.parse(cli(['solo', '--json']).stdout);
    assert.equal(s.mode, 'solo');
    assert.ok(Date.parse(s.until) > Date.now() + 60 * 60_000);
    for (const args of [['ask', 'gemini', 'hi'], ['run', 'hi'], ['review'], ['bench', '--agentic', '--setups', 'claude-lead']]) {
      const r = cli(args);
      assert.notEqual(r.status, 0, args.join(' '));
      assert.match(r.stderr, /solo mode is on/, args.join(' '));
    }
    assert.equal(cli(['solo', 'off']).status, 0);
    assert.deepEqual(JSON.parse(cli(['solo', '--json']).stdout), { mode: 'ask', until: null });
    assert.notEqual(cli(['solo', 'bogus']).status, 0);
    assert.notEqual(cli(['mode', 'bogus']).status, 0);
  });

  it('solo off only ends solo, never free', () => {
    assert.equal(cli(['mode', 'free']).status, 0);
    try {
      assert.equal(cli(['solo', 'off']).status, 0);
      assert.deepEqual(JSON.parse(cli(['mode', '--json']).stdout), { mode: 'free', until: null });
    } finally {
      cli(['mode', 'ask']);
    }
  });

  it('rejects bad --for values for both mode free and solo on, leaving config unchanged', () => {
    assert.equal(cli(['mode', 'ask']).status, 0);
    for (const prefix of [['mode', 'free'], ['solo', 'on']]) {
      for (const bad of [['--for', '0'], ['--for=0s'], ['--for'], ['--for', 'abc'], ['--for', '9999h']]) {
        const r = cli([...prefix, ...bad]);
        assert.notEqual(r.status, 0, `${prefix.join(' ')} ${bad.join(' ')}`);
        assert.match(r.stderr, /--for needs|Bad duration/, `${prefix.join(' ')} ${bad.join(' ')}`);
      }
    }
    assert.deepEqual(JSON.parse(cli(['mode', '--json']).stdout), { mode: 'ask', until: null });
  });

  it('rejects --for on ask', () => {
    const r = cli(['mode', 'ask', '--for', '1h']);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /--for only applies to free or solo/);
  });

  it('stats --json reports mode', () => {
    assert.equal(cli(['solo', 'on', '--for', '1h']).status, 0);
    try {
      const stats = JSON.parse(cli(['stats', '--json']).stdout);
      assert.equal(stats.mode.mode, 'solo');
      assert.ok(stats.mode.until);
    } finally {
      cli(['solo', 'off']);
    }
  });

  it('per-prompt hooks inject free mode, respect TANDEM_MANAGED, persist mode-state.json, and reset on ask', () => {
    assert.equal(cli(['mode', 'free', '--for', '2h']).status, 0);
    try {
      const g1 = cli(['hook', 'gemini', 'prompt'], { input: JSON.stringify({ conversationId: 'c1' }) });
      assert.equal(g1.status, 0);
      const g1Json = JSON.parse(g1.stdout);
      assert.match(g1Json.injectSteps[0].systemMessage.systemMessage, /tandem mode: free/);
      assert.match(g1Json.injectSteps[0].systemMessage.systemMessage, /Claude/);

      const g2 = cli(['hook', 'gemini', 'prompt'], { input: JSON.stringify({ conversationId: 'c1' }) });
      assert.equal(g2.status, 0);
      assert.equal(g2.stdout, '{}\n');

      const c1 = cli(['hook', 'claude', 'prompt'], { input: JSON.stringify({ session_id: 's1' }) });
      assert.equal(c1.status, 0);
      const c1Json = JSON.parse(c1.stdout);
      assert.equal(c1Json.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
      assert.match(c1Json.hookSpecificOutput.additionalContext, /tandem mode: free/);
      assert.match(c1Json.hookSpecificOutput.additionalContext, /Gemini/);

      const c2 = cli(['hook', 'claude', 'prompt'], { input: JSON.stringify({ session_id: 's1' }) });
      assert.equal(c2.status, 0);
      assert.equal(JSON.parse(c2.stdout).hookSpecificOutput.additionalContext, c1Json.hookSpecificOutput.additionalContext);

      const managedC = cli(['hook', 'claude', 'prompt'], { input: JSON.stringify({ session_id: 's1' }), env: { TANDEM_MANAGED: '1' } });
      assert.equal(managedC.status, 0);
      assert.equal(managedC.stdout, '');

      const managedG = cli(['hook', 'gemini', 'prompt'], { input: JSON.stringify({ conversationId: 'c2' }), env: { TANDEM_MANAGED: '1' } });
      assert.equal(managedG.status, 0);
      assert.equal(managedG.stdout, '{}\n');

      const stateFile = path.join(home, 'mode-state.json');
      assert.ok(fs.existsSync(stateFile));
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      assert.ok(state['gemini:c1']?.startsWith('free|'));
      assert.ok(state['claude:s1']?.startsWith('free|'));

      assert.equal(cli(['mode', 'ask']).status, 0);
      const reset1 = cli(['hook', 'gemini', 'prompt'], { input: JSON.stringify({ conversationId: 'c1' }) });
      assert.equal(reset1.status, 0);
      assert.equal(JSON.parse(reset1.stdout).injectSteps[0].systemMessage.systemMessage, MODE_RESET);

      const reset2 = cli(['hook', 'gemini', 'prompt'], { input: JSON.stringify({ conversationId: 'c1' }) });
      assert.equal(reset2.status, 0);
      assert.equal(reset2.stdout, '{}\n');
    } finally {
      cli(['mode', 'ask']);
    }
  });

  it('MCP ask_gemini returns an error while mode solo is on; tandem_stats reports mode', async () => {
    assert.equal(cli(['mode', 'solo']).status, 0);
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
      assert.equal(stats.mode.mode, 'solo');
    } finally {
      child.kill();
      cli(['mode', 'ask']);
    }
  });
});
