import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const prevHome = process.env.TANDEM_HOME;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-'));
process.env.TANDEM_HOME = tmpDir;

const {
  claudeEquivalentUsd,
  makeRecord,
  appendRecord,
  readRecords,
  summarize,
  ledgerPath,
} = await import('../src/ledger.js');
const { DEFAULT_CONFIG } = await import('../src/config.js');

after(() => {
  if (prevHome === undefined) delete process.env.TANDEM_HOME;
  else process.env.TANDEM_HOME = prevHome;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('ledger', () => {
  it('claudeEquivalentUsd prices fresh input, cacheRead, and output+thinking', () => {
    const usage = {
      input: 1_000_000,
      cacheRead: 400_000,
      output: 100_000,
      thinking: 50_000,
    };
    // claude-sonnet-5-5: input=2, output=10, cacheRead=0.2 per 1M
    // freshInput = 600k -> 1.2; cacheRead = 400k -> 0.08; out+thinking = 150k -> 1.5
    const usd = claudeEquivalentUsd(usage, DEFAULT_CONFIG.pricing, 'claude-sonnet-5-5');
    assert.ok(Math.abs(usd - 2.78) < 1e-9);
  });

  it('claudeEquivalentUsd returns 0 for unknown model', () => {
    const usd = claudeEquivalentUsd({ input: 1000, output: 500 }, DEFAULT_CONFIG.pricing, 'unknown-model');
    assert.equal(usd, 0);
  });

  it('makeRecord sets gemini costUsd=0 and claudeEquivUsd from baseline', () => {
    const rec = makeRecord(
      {
        agent: 'gemini',
        model: 'gemini-4-hydrogen-medium',
        status: 'ok',
        durationMs: 1200,
        turns: 2,
        usage: { input: 500_000, cacheRead: 0, output: 100_000, thinking: 0, total: 600_000 },
        costUsd: 0,
        sessionId: 'g-1',
        denied: [],
        error: null,
      },
      { from: 'claude', category: 'boilerplate', promptChars: 42 },
      DEFAULT_CONFIG,
    );
    assert.equal(rec.costUsd, 0);
    // 0.5 * 2 + 0.1 * 10 = 2.0
    assert.equal(rec.claudeEquivUsd, 2);
  });

  it('makeRecord sets claude claudeEquivUsd === costUsd', () => {
    const rec = makeRecord(
      {
        agent: 'claude',
        model: 'claude-sonnet-5-5',
        status: 'ok',
        durationMs: 2500,
        turns: 3,
        usage: { input: 1000, cacheRead: 0, output: 500, thinking: 0, total: 1500 },
        costUsd: 0.123456,
        sessionId: 'c-1',
        denied: [],
        error: null,
      },
      { from: 'user', category: 'hard-debug', promptChars: 20 },
      DEFAULT_CONFIG,
    );
    assert.equal(rec.costUsd, 0.123456);
    assert.equal(rec.claudeEquivUsd, rec.costUsd);
  });

  it('appendRecord/readRecords round-trips and skips a torn last line', () => {
    const r1 = makeRecord(
      {
        agent: 'gemini',
        model: 'gemini-3.8-flash-medium',
        status: 'ok',
        durationMs: 100,
        turns: 1,
        usage: { input: 1000, output: 200, total: 1200 },
        costUsd: 0,
        sessionId: 's1',
        denied: [],
        error: null,
      },
      {},
      DEFAULT_CONFIG,
    );
    const r2 = makeRecord(
      {
        agent: 'claude',
        model: 'claude-sonnet-5-5',
        status: 'ok',
        durationMs: 200,
        turns: 1,
        usage: { input: 1000, output: 200, total: 1200 },
        costUsd: 0.05,
        sessionId: 's2',
        denied: [],
        error: null,
      },
      {},
      DEFAULT_CONFIG,
    );
    appendRecord(r1);
    appendRecord(r2);
    fs.appendFileSync(ledgerPath(), '{"v":1,"torn":true');

    const records = readRecords();
    assert.equal(records.length, 2);
    assert.equal(records[0].id, r1.id);
    assert.equal(records[1].id, r2.id);
  });

  it('summarize computes totals, 7-day window, and budget ratios with caps', () => {
    const now = Date.parse('2026-11-23T12:00:00.000Z');
    const H = 3600_000;
    const records = [
      {
        ts: new Date(now - 8 * 24 * H).toISOString(),
        from: 'user',
        to: 'claude',
        model: 'claude-sonnet-5-5',
        status: 'ok',
        usage: { total: 1000 },
        costUsd: 4.0,
        claudeEquivUsd: 4.0,
        durationMs: 500,
      },
      {
        ts: new Date(now - 2 * 24 * H).toISOString(),
        from: 'user',
        to: 'claude',
        model: 'claude-sonnet-5-5',
        status: 'ok',
        usage: { total: 2000 },
        costUsd: 2.5,
        claudeEquivUsd: 2.5,
        durationMs: 600,
      },
      {
        ts: new Date(now - 1 * H).toISOString(),
        from: 'claude',
        to: 'gemini',
        model: 'gemini-4-hydrogen-medium',
        status: 'ok',
        usage: { total: 3000 },
        costUsd: 0,
        claudeEquivUsd: 1.5,
        durationMs: 300,
      },
    ];
    const cfg = {
      ...DEFAULT_CONFIG,
      budgets: { claudeWeeklyUsd: 10, gemini5hCalls: 4, geminiWeeklyCalls: 20, warnAt: 0.8 },
    };

    const s = summarize(records, cfg, now);
    assert.equal(s.totals.calls, 3);
    assert.equal(s.totals.claude.calls, 2);
    assert.equal(s.totals.gemini.calls, 1);
    assert.equal(s.savings.claudeWeekUsd, 2.5);
    assert.equal(s.savings.offloadedWeekUsd, 1.5);
    assert.equal(s.budget.claudeWeek.used, 2.5);
    assert.equal(s.budget.claudeWeek.ratio, 0.25);
    assert.equal(s.budget.gemini5h.used, 1);
    assert.equal(s.budget.gemini5h.ratio, 0.25);
    assert.equal(s.budget.geminiWeek.used, 1);
    assert.equal(s.budget.geminiWeek.ratio, 0.05);
    assert.equal(s.budget.geminiLikelyLimited, false);
  });

  it('summarize returns null ratios without caps and detects geminiLikelyLimited within 5h', () => {
    const now = Date.parse('2026-11-23T12:00:00.000Z');
    const H = 3600_000;
    const records = [
      {
        ts: new Date(now - 2 * H).toISOString(),
        from: 'user',
        to: 'gemini',
        model: 'gemini-4-neon-medium',
        status: 'quota',
        usage: { total: 0 },
        costUsd: 0,
        claudeEquivUsd: 0,
        durationMs: 100,
      },
    ];

    const s = summarize(records, DEFAULT_CONFIG, now);
    assert.equal(s.budget.claudeWeek.ratio, null);
    assert.equal(s.budget.gemini5h.ratio, null);
    assert.equal(s.budget.geminiWeek.ratio, null);
    assert.equal(s.budget.geminiLikelyLimited, true);
  });
});
