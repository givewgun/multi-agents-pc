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

/** Compare plan usage with the configured window limits. */
export function planBudget(usage, cfg, records = [], now = Date.now()) {
  const b = { ...DEFAULT_BUDGETS, ...(cfg.budgets || {}) };
  const side = (snap, lim5h, limWeek) => {
    if (!snap) return { known: false, exhausted: false, warn: false, fiveHour: null, weekly: null, limits: { fiveHour: lim5h, weekly: limWeek } };
    const u5 = snap.fiveHour?.used ?? 0;
    const uw = snap.weekly?.used ?? 0;
    const exhausted = snap.status === 'rejected' || u5 >= lim5h || uw >= limWeek;
    return {
      known: true, at: snap.at, ageMs: snap.ageMs ?? null, source: snap.source, status: snap.status ?? null,
      fiveHour: snap.fiveHour, weekly: snap.weekly, other: snap.other,
      limits: { fiveHour: lim5h, weekly: limWeek },
      exhausted,
      warn: !exhausted && (u5 >= b.warnAt * lim5h || uw >= b.warnAt * limWeek),
    };
  };
  const claude = side(usage?.claude, b.claude5h, b.claudeWeek);
  const gemini = side(usage?.gemini, b.gemini5h, b.geminiWeek);
  // A quota error is ground truth even if the last snapshot looked fine.
  const lastQuota = [...records].reverse().find((r) => r.to === 'gemini' && r.status === 'quota');
  const recentQuota = !!lastQuota && now - Date.parse(lastQuota.ts) < 5 * H && !(gemini.known && Date.parse(gemini.at) > Date.parse(lastQuota.ts));
  if (recentQuota) gemini.exhausted = true;
  return { warnAt: b.warnAt, claude, gemini, geminiQuotaHitAt: lastQuota?.ts ?? null };
}

const DEFAULT_BUDGETS = { claude5h: 0.8, claudeWeek: 0.85, gemini5h: 0.95, geminiWeek: 0.95, warnAt: 0.7 };

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
    // Plan usage right after the call (Claude only; Gemini's comes from `agy /usage`).
    plan: res.plan ? { fiveHour: res.plan.fiveHour?.used ?? null, weekly: res.plan.weekly?.used ?? null } : undefined,
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
    let r;
    try { r = JSON.parse(line); } catch { continue; /* torn line */ }
    if (r && typeof r === 'object' && typeof r.ts === 'string' && typeof r.to === 'string') out.push(r);
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
/** @param usage getUsage() result ({claude, gemini} plan snapshots) or null if unknown */
export function summarize(records, cfg, now = Date.now(), usage = null) {
  const since = (ms) => records.filter((r) => now - Date.parse(r.ts) <= ms);
  const week = since(7 * 24 * H);
  const fiveH = since(5 * H);

  // Null-prototype maps: keys come from ledger data ("constructor" must not collide).
  const map = () => Object.create(null);
  const byAgent = Object.assign(map(), { claude: bucket(), gemini: bucket() });
  const byModel = map();
  const byDay = map();
  const byCategory = map();
  const edges = map();
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
    activity: {
      fiveHour: { claude: fiveH.filter((r) => r.to === 'claude').length, gemini: fiveH.filter((r) => r.to === 'gemini').length },
      week: { claude: week.filter((r) => r.to === 'claude').length, gemini: week.filter((r) => r.to === 'gemini').length },
    },
    budget: planBudget(usage, cfg, records, now),
    recent: records.slice(-50).reverse(),
  };
}
