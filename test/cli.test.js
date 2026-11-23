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
