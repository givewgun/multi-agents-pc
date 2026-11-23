import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export function tandemHome() {
  return process.env.TANDEM_HOME || path.join(os.homedir(), '.tandem');
}

// USD per 1M tokens, Anthropic first-party list prices.
export const DEFAULT_PRICING = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

export const GEMINI_ALIASES = {
  flash: 'gemini-3.8-flash-medium',
  'flash-low': 'gemini-3.8-flash-low',
  hydrogen: 'gemini-4-hydrogen-medium',
  orchestrator: 'gemini-pro-orchestrator-neon',
  neon: 'gemini-4-neon-medium',
  'neon-high': 'gemini-4-neon-high',
  argon: 'gemini-4-argon-medium',
};

export const CLAUDE_ALIASES = {
  haiku: 'claude-haiku-5-5',
  sonnet: 'claude-sonnet-5-5',
  opus: 'claude-opus-5-5',
};

export const DEFAULT_CONFIG = {
  // Claude model whose prices value work Gemini did instead ("what would this have cost on Claude?").
  savingsBaseline: 'claude-sonnet-5-5',
  pricing: DEFAULT_PRICING,
  subscriptions: {
    claude: { plan: null, monthlyUsd: null },
    gemini: { plan: 'Google AI Pro', monthlyUsd: null },
  },
  // Both plans meter usage in a rolling 5-hour window plus a weekly window (fraction used, 0–1,
  // read from the agents themselves; see src/usage.js). These are the highest fractions tandem
  // will push each window to before routing work to the other agent. Claude's are lower so the
  // rest stays free for your own interactive Claude Code sessions.
  budgets: {
    claude5h: 0.8,
    claudeWeek: 0.85,
    gemini5h: 0.95,
    geminiWeek: 0.95,
    warnAt: 0.7,
  },
  // `tandem prefer <agent> <model>` writes these.
  defaults: { claudeModel: 'sonnet', geminiModel: 'neon' },
  // `tandem pin <category> <agent:model>` — the user's choice beats routing rules.
  routing: { pins: {} },
  timeouts: { geminiMs: 15 * 60_000, claudeMs: 15 * 60_000 },
  // Commands headless agents may run on --edit calls, e.g. "npm test;node --test". Opt-in: tests run
  // repo code the agent may have just written, so only grant this for repos you trust.
  allowCommands: [],
  // `tandem mode ask|free|solo [--for 5h]`. ask: delegate only when the user asks (default).
  // free: the user pre-approved delegation on every turn. solo: block every agent-to-agent call.
  // An expired `until` falls back to ask.
  mode: { value: 'ask', until: null },
  paths: { agy: null, claude: null },
};

function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function deepMerge(base, over) {
  if (!isObj(over)) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (UNSAFE_KEYS.has(k)) continue;
    out[k] = isObj(v) && isObj(base[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}

export function configPath() { return path.join(tandemHome(), 'config.json'); }

export function readUserConfig() {
  const p = configPath();
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch (e) {
    throw new Error(`Invalid JSON in ${p}: ${e.message}`);
  }
}

export function loadConfig() { return deepMerge(DEFAULT_CONFIG, readUserConfig()); }

export function saveUserConfig(cfg) {
  mkdirSync(tandemHome(), { recursive: true });
  writeFileSync(configPath(), JSON.stringify(cfg, null, 2) + '\n');
}

/** Set a dotted key ("budgets.claudeWeeklyUsd") in the user config file. */
export function setConfigValue(key, raw) {
  if (typeof key !== 'string' || !key || raw == null) throw new Error('Usage: tandem config set <dotted.key> <value>');
  const parts = key.split('.');
  if (parts.some((p) => !p || UNSAFE_KEYS.has(p))) throw new Error(`Invalid config key "${key}"`);
  const cfg = readUserConfig();
  let value = raw;
  if (raw === 'null') value = null;
  else if (raw === 'true' || raw === 'false') value = raw === 'true';
  else if (raw.trim() !== '' && Number.isFinite(Number(raw))) value = Number(raw);
  let node = cfg;
  for (const p of parts.slice(0, -1)) node = isObj(node[p]) ? node[p] : (node[p] = {});
  node[parts.at(-1)] = value;
  saveUserConfig(cfg);
  return value;
}

export const MODES = ['ask', 'free', 'solo'];

/** Delegation mode now: {mode, until}. Unknown or expired → ask. */
export function modeState(cfg, now = Date.now()) {
  const m = cfg?.mode || {};
  const mode = MODES.includes(m.value) ? m.value : 'ask';
  const until = m.until ? Date.parse(m.until) : null;
  const timed = until != null && !Number.isNaN(until);
  if (mode === 'ask' || (timed && until <= now)) return { mode: 'ask', until: null };
  return { mode, until: timed ? new Date(until).toISOString() : null };
}

/** Error text when solo mode blocks a delegated call, else null. */
export function soloBlock(cfg, now = Date.now()) {
  const s = modeState(cfg, now);
  if (s.mode !== 'solo') return null;
  return `solo mode is on${s.until ? ` until ${s.until}` : ''}: the user wants a single agent, so no calls to the other agent. Do the work yourself. (User: \`tandem mode ask\` to re-enable.)`;
}

/** Text injected into the lead's context on every user turn (per-prompt hooks), or null in ask mode. */
export function modeContext(cfg, lead, now = Date.now()) {
  const s = modeState(cfg, now);
  const until = s.until ? ` until ${s.until}` : '';
  const partner = lead === 'gemini' ? 'Claude' : 'Gemini';
  if (s.mode === 'free') {
    return `tandem mode: free${until}. The user pre-approved delegation for every task, as if they said "use tandem freely": ` +
      `decompose the task, classify each part, call route_task with your category, delegate to ${partner} where it is the better or cheaper fit, ` +
      'verify the results, and tell the user what each agent did. Small or context-heavy work: just do it yourself.';
  }
  if (s.mode === 'solo') return `tandem mode: solo${until}. The user wants you alone: do not call ${partner}, even if a skill suggests it.`;
  return null;
}

export function resolveGeminiModel(m) { return m ? (GEMINI_ALIASES[m] || m) : null; }
export function resolveClaudeModel(m) { return m ? (CLAUDE_ALIASES[m] || m) : null; }
