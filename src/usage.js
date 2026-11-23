// Plan usage: how much of each subscription's 5-hour and weekly window is used.
// Both plans are flat-rate with rolling windows, so this (not dollars) is the real budget.
//   Gemini: `agy -p /usage --output-format json` — free, no tokens.
//   Claude: `rate_limit_event` in `claude -p` stream-json — captured from every Claude call tandem
//           makes (no extra cost). Reflects the whole plan, including interactive Claude Code use.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { tandemHome } from './config.js';
import { run } from './proc.js';
import { findAgy, lastJsonLine } from './agents.js';

export function usagePath() { return path.join(tandemHome(), 'usage.json'); }

export function readUsage() {
  try {
    const u = JSON.parse(readFileSync(usagePath(), 'utf8'));
    return u && typeof u === 'object' ? u : {};
  } catch { return {}; }
}

function saveUsage(u) {
  mkdirSync(tandemHome(), { recursive: true });
  writeFileSync(usagePath(), JSON.stringify(u, null, 2) + '\n');
}

export function storeSnapshot(agent, snap) {
  if (!snap) return;
  const u = readUsage();
  u[agent] = snap;
  saveUsage(u);
}

const window = (used, resetsAt) => ({ used: Math.min(1, Math.max(0, Number(used) || 0)), resetsAt: resetsAt || null });

/** Claude stream-json `rate_limit_event` → snapshot. */
export function parseClaudeRateLimit(ev, at = new Date().toISOString()) {
  const info = ev?.rate_limit_info;
  const w = info?.unifiedWindows;
  if (!w) return null;
  const iso = (s) => (typeof s === 'number' ? new Date(s * 1000).toISOString() : null);
  return {
    source: 'claude rate_limit_event',
    at,
    status: info.status || null,
    fiveHour: window(w.five_hour?.utilization, iso(w.five_hour?.resetsAt)),
    weekly: window(w.seven_day?.utilization, iso(w.seven_day?.resetsAt)),
  };
}

/** `agy /usage` command data → snapshot of the "Gemini Models" group (plus per-model extras). */
export function parseAgyUsage(j, at = new Date().toISOString()) {
  const groups = j?.command?.data?.groups;
  if (!Array.isArray(groups)) return null;
  const pick = (g, win) => g?.buckets?.find((b) => b.window === win);
  const toWin = (b) => (b ? window(1 - (b.remaining_fraction ?? 1), b.reset_time) : null);
  const gem = groups.find((g) => /^gemini models$/i.test(g.name)) || groups.find((g) => /gemini/i.test(g.name));
  if (!gem) return null;
  return {
    source: 'agy /usage',
    at,
    status: null,
    fiveHour: toWin(pick(gem, '5h')),
    weekly: toWin(pick(gem, 'weekly')),
    // Separate pools (e.g. "Gemini 4 Argon" weekly, "Claude and GPT models") for display.
    other: groups.filter((g) => g !== gem).map((g) => ({
      name: g.name,
      windows: (g.buckets || []).map((b) => ({ window: b.window, ...window(1 - (b.remaining_fraction ?? 1), b.reset_time) })),
    })),
  };
}

export async function refreshGemini(cfg) {
  const bin = findAgy(cfg);
  if (!bin) return null;
  const r = await run(bin, ['-p', '/usage', '--output-format', 'json'], { timeoutMs: 30_000 });
  const snap = parseAgyUsage(lastJsonLine(r.stdout));
  storeSnapshot('gemini', snap);
  return snap;
}

/** A window whose reset time has passed is back to 0. */
function current(snap, now) {
  if (!snap) return null;
  const fix = (w) => (w && w.resetsAt && Date.parse(w.resetsAt) <= now ? { ...w, used: 0, reset: true } : w);
  return { ...snap, fiveHour: fix(snap.fiveHour), weekly: fix(snap.weekly), ageMs: now - Date.parse(snap.at) };
}

/**
 * Current plan usage. Gemini is refreshed (free) when older than maxAgeMs; Claude only updates
 * as a side effect of Claude calls.
 */
export async function getUsage(cfg, { maxAgeMs = 5 * 60_000, refresh = false, now = Date.now() } = {}) {
  const u = readUsage();
  const gAge = u.gemini?.at ? now - Date.parse(u.gemini.at) : Infinity;
  if (refresh || gAge > maxAgeMs) {
    try { await refreshGemini(cfg); } catch { /* keep the cached snapshot */ }
  }
  const fresh = readUsage();
  return { claude: current(fresh.claude, now), gemini: current(fresh.gemini, now) };
}

export function usageExists() { return existsSync(usagePath()); }
