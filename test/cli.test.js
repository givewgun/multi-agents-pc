import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, inferCaller } from '../src/cli.js';

describe('parseArgs', () => {
  it('parses positional arguments', () => {
    const res = parseArgs(['ask', 'gemini', 'hello world']);
    assert.deepEqual(res._, ['ask', 'gemini', 'hello world']);
    assert.deepEqual(res.flags, {});
  });

  it('parses --k v and --k=v options', () => {
    const res = parseArgs(['ask', '--model', 'hydrogen', '--tag=a=b']);
    assert.deepEqual(res._, ['ask']);
    assert.equal(res.flags.model, 'hydrogen');
    assert.equal(res.flags.tag, 'a=b');
  });

  it('parses boolean flags like --edit and --json', () => {
    const res = parseArgs(['run', '--edit', '--json', 'fix bug']);
    assert.deepEqual(res._, ['run', 'fix bug']);
    assert.equal(res.flags.edit, true);
    assert.equal(res.flags.json, true);
  });

  it('passes through arguments after -- as positional', () => {
    const res = parseArgs(['run', '--edit', '--', '--not-a-flag', 'pos']);
    assert.deepEqual(res._, ['run', '--not-a-flag', 'pos']);
    assert.deepEqual(res.flags, { edit: true });
  });

  it('parses --version, -v, and -V flags', () => {
    assert.equal(parseArgs(['--version']).flags.version, true);
    assert.equal(parseArgs(['-v']).flags.version, true);
    assert.equal(parseArgs(['-V']).flags.version, true);
  });
});

describe('inferCaller', () => {
  it('prefers explicit --from over env vars', () => {
    assert.equal(inferCaller({ from: 'user' }, { TANDEM_CALLER: 'gemini', CLAUDECODE: '1' }), 'user');
  });

  it('prefers TANDEM_CALLER over CLAUDECODE', () => {
    assert.equal(inferCaller({}, { TANDEM_CALLER: 'gemini', CLAUDECODE: '1' }), 'gemini');
  });

  it('detects Claude Code via CLAUDECODE or CLAUDE_CODE_ENTRYPOINT', () => {
    assert.equal(inferCaller({}, { CLAUDECODE: '1' }), 'claude');
    assert.equal(inferCaller({}, { CLAUDE_CODE_ENTRYPOINT: 'cli' }), 'claude');
  });

  it('defaults to user when no caller signals are present or CLAUDECODE is falsy', () => {
    assert.equal(inferCaller({}, {}), 'user');
    assert.equal(inferCaller({}, { CLAUDECODE: '0', CLAUDE_CODE_ENTRYPOINT: '   ' }), 'user');
  });
});

describe('tandem route --category', () => {
  it('uses the lead category and rejects unknown ones', async () => {
    const { spawnSync } = await import('node:child_process');
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'tandem.js');
    const { seedUsage } = await import('./_usage-seed.js');
    const env = { ...process.env, TANDEM_HOME: seedUsage(mkdtempSync(path.join(tmpdir(), 'tandem-cli-'))) };
    const run = (...a) => spawnSync(process.execPath, [bin, 'route', ...a], { env, encoding: 'utf8' });
    const ok = JSON.parse(run('mod skyrim papyrus', '--category', 'research', '--json').stdout);
    assert.equal(ok.category, 'research');
    assert.equal(ok.source, 'lead');
    const bad = run('x', '--category', 'bogus');
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /Unknown category/);
  });
});
