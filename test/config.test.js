import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const prevHome = process.env.TANDEM_HOME;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-cfg-'));
process.env.TANDEM_HOME = tmpDir;

const {
  deepMerge,
  setConfigValue,
  readUserConfig,
  resolveGeminiModel,
  resolveClaudeModel,
} = await import('../src/config.js');

after(() => {
  if (prevHome === undefined) delete process.env.TANDEM_HOME;
  else process.env.TANDEM_HOME = prevHome;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('config', () => {
  it('deepMerge merges nested objects, replaces arrays, and leaves base unchanged', () => {
    const base = {
      a: { x: 1, y: 2 },
      arr: [1, 2],
      keep: true,
    };
    const merged = deepMerge(base, {
      a: { y: 99 },
      arr: [3],
    });

    assert.deepEqual(merged, {
      a: { x: 1, y: 99 },
      arr: [3],
      keep: true,
    });
    assert.deepEqual(base, {
      a: { x: 1, y: 2 },
      arr: [1, 2],
      keep: true,
    });
  });

  it('setConfigValue coerces numbers, booleans, null, and creates dotted nesting', () => {
    assert.equal(setConfigValue('budgets.claudeWeeklyUsd', '12'), 12);
    assert.equal(setConfigValue('nested.flag', 'true'), true);
    assert.equal(setConfigValue('nested.cleared', 'null'), null);
    assert.equal(setConfigValue('nested.label', 'hello'), 'hello');

    const saved = readUserConfig();
    assert.deepEqual(saved, {
      budgets: { claudeWeeklyUsd: 12 },
      nested: { flag: true, cleared: null, label: 'hello' },
    });
  });

  it('resolves gemini and claude model aliases and passes through unknown slugs', () => {
    assert.equal(resolveGeminiModel('hydrogen'), 'gemini-4-hydrogen-medium');
    assert.equal(resolveGeminiModel('neon-high'), 'gemini-4-neon-high');
    assert.equal(resolveGeminiModel('custom-gemini'), 'custom-gemini');
    assert.equal(resolveGeminiModel(null), null);

    assert.equal(resolveClaudeModel('sonnet'), 'claude-sonnet-5-5');
    assert.equal(resolveClaudeModel('opus'), 'claude-opus-5-5');
    assert.equal(resolveClaudeModel('custom-claude'), 'custom-claude');
    assert.equal(resolveClaudeModel(undefined), null);
  });
});
