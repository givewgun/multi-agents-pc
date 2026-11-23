import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../src/cli.js';

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
});
