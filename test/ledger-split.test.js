import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const prevHome = process.env.TANDEM_HOME;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-'));
process.env.TANDEM_HOME = tmpDir;

const { summarize } = await import('../src/ledger.js');
const { DEFAULT_CONFIG } = await import('../src/config.js');

after(() => {
  if (prevHome === undefined) delete process.env.TANDEM_HOME;
  else process.env.TANDEM_HOME = prevHome;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('ledger workSplit and savings', () => {
  it('splits interactive vs delegated records in workSplit and excludes interactive Gemini from offloadedWeekUsd', () => {
    const now = Date.now();
    const ts = new Date(now - 60_000).toISOString();
    const records = [
      { ts, to: 'claude', from: 'user', status: 'ok', tag: 'interactive', usage: { total: 100 }, costUsd: 0.5, claudeEquivUsd: 0.5 },
      { ts, to: 'claude', from: 'user', status: 'ok', tag: null, usage: { total: 200 }, costUsd: 1.0, claudeEquivUsd: 1.0 },
      { ts, to: 'gemini', from: 'user', status: 'ok', tag: 'interactive', usage: { total: 300 }, costUsd: 0, claudeEquivUsd: 2.0 },
      { ts, to: 'gemini', from: 'claude', status: 'ok', tag: null, usage: { total: 400 }, costUsd: 0, claudeEquivUsd: 3.0 },
    ];

    const s = summarize(records, DEFAULT_CONFIG, now);

    assert.equal(s.workSplit.claude.interactive.calls, 1);
    assert.equal(s.workSplit.claude.interactive.tokens, 100);
    assert.equal(s.workSplit.claude.delegated.calls, 1);
    assert.equal(s.workSplit.claude.delegated.tokens, 200);

    assert.equal(s.workSplit.gemini.interactive.calls, 1);
    assert.equal(s.workSplit.gemini.interactive.tokens, 300);
    assert.equal(s.workSplit.gemini.interactive.claudeEquivUsd, 2.0);
    assert.equal(s.workSplit.gemini.delegated.calls, 1);
    assert.equal(s.workSplit.gemini.delegated.tokens, 400);
    assert.equal(s.workSplit.gemini.delegated.claudeEquivUsd, 3.0);

    assert.equal(s.savings.offloadedWeekUsd, 3.0);
  });
});
