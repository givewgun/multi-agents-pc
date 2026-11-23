import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-usage-'));
process.env.TANDEM_HOME = tmp;
const { parseClaudeRateLimit, parseAgyUsage, storeSnapshot, readUsage, getUsage } = await import('../src/usage.js');
const { claudeStream } = await import('../src/agents.js');
const { planBudget } = await import('../src/ledger.js');
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// Shapes captured from claude 2.1.330 and agy 1.5.14 on 2026-11-23.
const CLAUDE_EVENT = { type: 'rate_limit_event', rate_limit_info: { status: 'allowed', resetsAt: 1795420800, rateLimitType: 'five_hour', unifiedWindows: { five_hour: { utilization: 0.48, resetsAt: 1795420800, status: 'allowed' }, seven_day: { utilization: 0.1, resetsAt: 1795831200, status: 'allowed' } } } };
const AGY_USAGE = { status: 'SUCCESS', command: { name: 'usage', data: { groups: [
  { name: 'Gemini Models', buckets: [
    { id: 'gemini-weekly', window: 'weekly', remaining_fraction: 0.94, reset_time: '2026-11-30T04:06:30Z' },
    { id: 'gemini-5h', window: '5h', remaining_fraction: 0.84, reset_time: '2026-11-23T09:06:30Z' }] },
  { name: 'Claude and GPT models', buckets: [{ id: '3p-weekly', window: 'weekly', remaining_fraction: 1, reset_time: '2026-11-30T05:12:02Z' }] },
  { name: 'Gemini 4 Argon', buckets: [{ id: 'gemini-argon-wtu-weekly', window: 'weekly', remaining_fraction: 0.75, reset_time: '2026-11-30T05:12:02Z' }] },
] } } };

describe('plan usage', () => {
  it('parses Claude rate_limit_event', () => {
    const s = parseClaudeRateLimit(CLAUDE_EVENT, '2026-11-23T05:00:00Z');
    assert.equal(s.fiveHour.used, 0.48);
    assert.equal(s.weekly.used, 0.1);
    assert.equal(s.fiveHour.resetsAt, new Date(1795420800 * 1000).toISOString());
    assert.equal(s.status, 'allowed');
    assert.equal(parseClaudeRateLimit({ type: 'rate_limit_event' }), null);
  });

  it('parses agy /usage: Gemini group windows plus other pools', () => {
    const s = parseAgyUsage(AGY_USAGE, '2026-11-23T05:00:00Z');
    assert.ok(Math.abs(s.fiveHour.used - 0.16) < 1e-9);
    assert.ok(Math.abs(s.weekly.used - 0.06) < 1e-9);
    assert.equal(s.other.find((o) => o.name === 'Gemini 4 Argon').windows[0].used, 0.25);
    assert.equal(parseAgyUsage({ status: 'SUCCESS' }), null);
  });

  it('claudeStream finds result and plan in stream-json', () => {
    const out = ['{"type":"system","subtype":"init"}', JSON.stringify(CLAUDE_EVENT), '{"type":"result","result":"ok","is_error":false,"total_cost_usd":0.006}'].join('\n');
    const { final, plan } = claudeStream(out);
    assert.equal(final.result, 'ok');
    assert.equal(plan.fiveHour.used, 0.48);
  });

  it('a window past its reset time reads as 0', async () => {
    storeSnapshot('claude', { at: '2026-11-23T00:00:00Z', source: 't', fiveHour: { used: 0.9, resetsAt: '2026-11-23T03:00:00Z' }, weekly: { used: 0.3, resetsAt: '2026-11-30T00:00:00Z' } });
    storeSnapshot('gemini', { at: new Date().toISOString(), source: 't', fiveHour: { used: 0.1 }, weekly: { used: 0.1 } });
    const u = await getUsage({ paths: {} }, { now: Date.parse('2026-11-23T04:00:00Z'), maxAgeMs: Infinity });
    assert.equal(u.claude.fiveHour.used, 0);
    assert.equal(u.claude.weekly.used, 0.3);
    assert.ok(readUsage().claude);
  });

  it('planBudget applies limits and warnAt per window', () => {
    const usage = { claude: { at: 'x', fiveHour: { used: 0.6 }, weekly: { used: 0.1 } }, gemini: { at: 'x', fiveHour: { used: 0.96 }, weekly: { used: 0.1 } } };
    const b = planBudget(usage, { budgets: { claude5h: 0.8, claudeWeek: 0.85, gemini5h: 0.95, geminiWeek: 0.95, warnAt: 0.7 } });
    assert.equal(b.claude.exhausted, false);
    assert.equal(b.claude.warn, true, '0.6 ≥ 0.7 × 0.8');
    assert.equal(b.gemini.exhausted, true);
    const rejected = planBudget({ claude: { at: 'x', status: 'rejected', fiveHour: { used: 0.2 }, weekly: { used: 0.1 } } }, {});
    assert.equal(rejected.claude.exhausted, true);
  });
});
