import { appendFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { tandemHome } from './config.js';

export function ledgerPath() { return path.join(tandemHome(), 'ledger.jsonl'); }

const H = 3600_000;

/** USD a call would cost at a Claude model's list price. Thinking bills as output. */
export function claudeEquivalentUsd(usage, pricing, model) {
  const p = pricing[model];
  if (!p) return 0;
  const cacheRead = Math.min(usage.cacheRead || 0, usage.input || 0);
  const freshInput = (usage.input || 0) - cacheRead;
  const out = (usage.output || 0) + (usage.thinking || 0);
  return (freshInput * p.input + cacheRead * p.cacheRead + out * p.output) / 1e6;
}

export function makeRecord(res, { from = 'user', category = null, tag = null, promptChars = 0, cwd = process.cwd() }, cfg) {
  const claudeEquivUsd = res.agent === 'claude'
    ? res.costUsd
    : claudeEquivalentUsd(res.usage, cfg.pricing, cfg.savingsBaseline);
  return {
    v: 1,
    id: randomUUID(),
    ts: new Date().toISOString(),
    from,
    to: res.agent,
    model: res.model,
    category,
    tag,
    project: path.basename(cwd),
    promptChars,
    status: res.status,
    durationMs: res.durationMs,
    turns: res.turns,
    usage: res.usage,
    costUsd: res.agent === 'claude' ? res.costUsd : 0,
    claudeEquivUsd: Number(claudeEquivUsd.toFixed(6)),
    sessionId: res.sessionId,
    denied: res.denied,
    error: res.error ? String(res.error).slice(0, 500) : null,
  };
}

export function appendRecord(rec) {
  mkdirSync(tandemHome(), { recursive: true });
  appendFileSync(ledgerPath(), JSON.stringify(rec) + '\n');
  return rec;
}

export function readRecords() {
  const p = ledgerPath();
  if (!existsSync(p)) return [];
  const out = [];
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip torn line */ }
  }
  return out;
}

function bucket() {
  return { calls: 0, ok: 0, failed: 0, tokens: 0, costUsd: 0, claudeEquivUsd: 0, durationMs: 0 };
}

function add(b, r) {
  b.calls++;
  if (r.status === 'ok') b.ok++; else b.failed++;
  b.tokens += r.usage?.total || 0;
  b.costUsd += r.costUsd || 0;
  b.claudeEquivUsd += r.claudeEquivUsd || 0;
  b.durationMs += r.durationMs || 0;
}

/** Aggregate the ledger for CLI stats, budget checks and the dashboard. */
export function summarize(records, cfg, now = Date.now()) {
  const since = (ms) => records.filter((r) => now - Date.parse(r.ts) <= ms);
  const week = since(7 * 24 * H);
  const fiveH = since(5 * H);

  const byAgent = { claude: bucket(), gemini: bucket() };
  const byModel = {};
  const byDay = {};
  const byCategory = {};
  const edges = {};
  for (const r of records) {
    add(byAgent[r.to] ||= bucket(), r);
    add(byModel[r.model || r.to] ||= bucket(), r);
    add(byDay[r.ts.slice(0, 10)] ||= bucket(), r);
    if (r.category) add(byCategory[r.category] ||= bucket(), r);
    add(edges[`${r.from}->${r.to}`] ||= bucket(), r);
  }

  const geminiOkWeek = week.filter((r) => r.to === 'gemini' && r.status === 'ok');
  const claudeWeekUsd = week.filter((r) => r.to === 'claude').reduce((s, r) => s + (r.costUsd || 0), 0);
  const offloadedWeekUsd = geminiOkWeek.reduce((s, r) => s + (r.claudeEquivUsd || 0), 0);
  const offloadedAllUsd = records.filter((r) => r.to === 'gemini' && r.status === 'ok')
    .reduce((s, r) => s + (r.claudeEquivUsd || 0), 0);

  const b = cfg.budgets || {};
  const ratio = (used, cap) => (cap ? used / cap : null);
  const lastQuota = [...records].reverse().find((r) => r.to === 'gemini' && r.status === 'quota');

  const sub = cfg.subscriptions || {};
  const monthly = (sub.claude?.monthlyUsd || 0) + (sub.gemini?.monthlyUsd || 0);

  return {
    generatedAt: new Date(now).toISOString(),
    totals: { calls: records.length, ...byAgent },
    byModel, byDay, byCategory, edges,
    savings: {
      baseline: cfg.savingsBaseline,
      offloadedWeekUsd, offloadedAllUsd,
      claudeWeekUsd,
      // Share of Claude-equivalent work this week that Gemini absorbed.
      offloadShareWeek: offloadedWeekUsd + claudeWeekUsd > 0 ? offloadedWeekUsd / (offloadedWeekUsd + claudeWeekUsd) : null,
      geminiMonthlyUsd: sub.gemini?.monthlyUsd ?? null,
      subscriptionsMonthlyUsd: monthly || null,
    },
    budget: {
      warnAt: b.warnAt ?? 0.8,
      claudeWeek: { used: claudeWeekUsd, cap: b.claudeWeeklyUsd ?? null, ratio: ratio(claudeWeekUsd, b.claudeWeeklyUsd) },
      gemini5h: { used: fiveH.filter((r) => r.to === 'gemini').length, cap: b.gemini5hCalls ?? null, ratio: ratio(fiveH.filter((r) => r.to === 'gemini').length, b.gemini5hCalls) },
      geminiWeek: { used: week.filter((r) => r.to === 'gemini').length, cap: b.geminiWeeklyCalls ?? null, ratio: ratio(week.filter((r) => r.to === 'gemini').length, b.geminiWeeklyCalls) },
      geminiQuotaHitAt: lastQuota?.ts ?? null,
      geminiLikelyLimited: !!lastQuota && now - Date.parse(lastQuota.ts) < 5 * H,
    },
    recent: records.slice(-50).reverse(),
  };
}
