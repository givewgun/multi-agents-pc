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
  budgets: {
    // Claude API-equivalent USD per rolling 7 days. Subscriptions report this as total_cost_usd.
    claudeWeeklyUsd: null,
    // Gemini quota is opaque; cap by call count per rolling 5h / 7d windows.
    gemini5hCalls: null,
    geminiWeeklyCalls: null,
    warnAt: 0.8,
  },
  defaults: { claudeModel: 'sonnet', geminiModel: 'neon' },
  timeouts: { geminiMs: 15 * 60_000, claudeMs: 15 * 60_000 },
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

export function resolveGeminiModel(m) { return m ? (GEMINI_ALIASES[m] || m) : null; }
export function resolveClaudeModel(m) { return m ? (CLAUDE_ALIASES[m] || m) : null; }
