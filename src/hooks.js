// Stop hooks: count the work the user does *directly* with an agent, so the ledger shows both
// agents' real contribution (ADR 0011). Hooks must be fast and must never fail the agent: every
// error is swallowed, and Antigravity always gets its required JSON decision.
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, openSync, readSync, fstatSync, statSync, closeSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { tandemHome, loadConfig, DEFAULT_CONFIG, modeContext, modeState } from './config.js';
import { makeRecord, appendRecord, claudeEquivalentUsd, readRecords } from './ledger.js';
import { which, isShim } from './proc.js';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'tandem.js');
const statePath = () => path.join(tandemHome(), 'hook-state.json');
const FIELDS = ['input', 'output', 'thinking', 'cacheRead', 'cacheWrite'];
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function readState() {
  try { const s = JSON.parse(readFileSync(statePath(), 'utf8')); return isObj(s) ? s : {}; } catch { return {}; }
}

/** Atomic write (temp + rename): a torn file must never make every session look new. */
function writeJsonAtomic(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  renameSync(tmp, file);
}

/** Re-read the latest state, change one session, write back: concurrent hooks/sweeps don't clobber each other. */
function saveSession(agent, sessionId, entry) {
  const s = readState();
  if (!isObj(s[agent])) s[agent] = {};
  s[agent][sessionId] = entry;
  writeJsonAtomic(statePath(), s);
}

/** Complete lines appended to `file` since byte `offset`; returns {lines, offset}. */
export function readNewLines(file, offset = 0) {
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    if (size < offset) offset = 0; // file was rewritten
    const buf = Buffer.alloc(size - offset);
    let pos = 0;
    while (pos < buf.length) {
      const n = readSync(fd, buf, pos, buf.length - pos, offset + pos);
      if (n === 0) break; // file shrank between stat and read
      pos += n;
    }
    const data = buf.subarray(0, pos);
    const end = data.lastIndexOf(0x0a); // only whole lines; a half-written one waits for next run
    if (end === -1) return { lines: [], offset };
    return { lines: data.subarray(0, end).toString('utf8').split('\n'), offset: offset + end + 1 };
  } finally { closeSync(fd); }
}

const parse = (l) => { try { return JSON.parse(l); } catch { return null; } };
const zero = () => ({ input: 0, output: 0, thinking: 0, cacheRead: 0, cacheWrite: 0, total: 0 });

/** Claude Code transcript lines → usage. Streamed messages repeat their usage per content block, so the last line per message id wins. */
export function claudeUsage(lines) {
  const byId = new Map();
  for (const l of lines) {
    const o = parse(l);
    const m = o?.type === 'assistant' ? o.message : null;
    if (m?.usage) byId.set(m.id || `${byId.size}`, { model: m.model, u: m.usage });
  }
  const usage = zero();
  let model = null;
  for (const { model: mm, u } of byId.values()) {
    model = mm || model;
    usage.cacheRead += u.cache_read_input_tokens || 0;
    usage.cacheWrite += u.cache_creation_input_tokens || 0;
    usage.input += (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    usage.output += u.output_tokens || 0;
  }
  usage.total = usage.input + usage.output;
  return { usage, model, turns: byId.size };
}

/** Antigravity transcript lines (one per step with token counts) → usage. */
export function geminiUsage(lines, fallbackModel = null) {
  const usage = zero();
  let model = fallbackModel;
  let turns = 0;
  for (const l of lines) {
    const o = parse(l);
    if (!o || (o.input_tokens == null && o.output_tokens == null)) continue;
    turns++;
    model = o.model || model;
    usage.input += o.input_tokens || 0;
    usage.output += o.output_tokens || 0;
    usage.cacheRead += o.cache_read_tokens || 0;
  }
  usage.total = usage.input + usage.output;
  return { usage, model, turns };
}

/** Tokens already in the ledger for a session (tandem-made calls that the user later resumed). */
function ledgerTotals(agent, sessionId) {
  const t = zero();
  for (const r of readRecords()) {
    if (r.to !== agent || r.sessionId !== sessionId) continue;
    for (const f of FIELDS) t[f] += r.usage?.[f] || 0;
  }
  return t;
}

/**
 * Log what a session used beyond what was already logged. Recomputing the session total (instead
 * of only reading new bytes) matters: Antigravity writes a step's token counts *after* its Stop
 * hook fires, so a later run (next turn, or a sweep) must still pick them up.
 */
export function reconcile(agent, sessionId, transcriptPath, { cwd = null, cfg = DEFAULT_CONFIG, modelHint = null, touch = false, now = Date.now() } = {}) {
  if (!sessionId || !transcriptPath || !existsSync(transcriptPath)) return null;
  const prev = readState()[agent]?.[sessionId];
  const st = isObj(prev) ? { ...prev, logged: { ...prev.logged } } : null;
  const { size, mtimeMs } = statSync(transcriptPath);
  if (st && st.size === size && st.mtimeMs === mtimeMs) {
    if (touch) saveSession(agent, sessionId, { ...st, at: new Date(now).toISOString() });
    return null; // nothing new on disk
  }
  const entry = st || { path: transcriptPath, cwd, logged: ledgerTotals(agent, sessionId), turns: 0, model: null };
  const { lines } = readNewLines(transcriptPath, 0);
  const { usage, model, turns } = agent === 'claude' ? claudeUsage(lines) : geminiUsage(lines, modelHint || entry.model);
  const delta = zero();
  for (const f of FIELDS) delta[f] = Math.max(0, (usage[f] || 0) - (entry.logged[f] || 0));
  delta.total = delta.input + delta.output;
  const newTurns = Math.max(0, turns - (entry.turns || 0));
  const next = {
    ...entry, size, mtimeMs, model: model || entry.model || null,
    turns: Math.max(turns, entry.turns || 0),
    logged: Object.fromEntries(FIELDS.map((f) => [f, Math.max(usage[f] || 0, entry.logged[f] || 0)])),
    // `at` drives the sweep window: only real activity keeps a session in it.
    at: delta.total || touch ? new Date(now).toISOString() : entry.at || new Date(now).toISOString(),
  };
  // Persist first: a crash after this loses one record, never double counts.
  saveSession(agent, sessionId, next);
  if (!delta.total) return null;
  const costUsd = agent === 'claude' ? claudeEquivalentUsd(delta, cfg.pricing, next.model) : 0;
  const res = {
    agent, model: next.model, ok: true, status: 'ok', text: '', sessionId, usage: delta, costUsd, durationMs: 0, turns: newTurns,
    denied: [], error: null, plan: null, transcriptPath,
  };
  return appendRecord(makeRecord(res, { from: 'user', tag: 'interactive', lead: agent, cwd: next.cwd || process.cwd() }, cfg));
}

/** Catch up sessions active in the last `withinMs` (late-written tokens). Unchanged files are skipped by size/mtime. */
export function sweep(cfg = DEFAULT_CONFIG, { withinMs = 24 * 3600_000, now = Date.now() } = {}) {
  let n = 0;
  try {
    const state = readState();
    for (const agent of ['claude', 'gemini']) {
      for (const [sid, st] of Object.entries(isObj(state[agent]) ? state[agent] : {})) {
        if (!st?.path || now - Date.parse(st.at || 0) > withinMs) continue;
        try { if (reconcile(agent, sid, st.path, { cwd: st.cwd, cfg, now })) n++; } catch { /* next session */ }
      }
    }
  } catch { /* never throw from a sweep */ }
  return n;
}

async function readStdin() {
  if (process.stdin.isTTY) return '';
  process.stdin.setEncoding('utf8');
  let s = '';
  for await (const chunk of process.stdin) s += chunk;
  return s;
}

/** True when the *other* agent's CLI spawned this agent outside tandem (e.g. Claude running raw `agy`). */
export function spawnedByOtherAgent(agent, env = process.env) {
  if (agent === 'gemini') return env.CLAUDECODE === '1' || Boolean(env.CLAUDE_CODE_ENTRYPOINT?.trim());
  return false;
}

/**
 * `tandem hook <claude|gemini> [prompt]` — called by each agent's hooks with the event JSON on stdin.
 * No event = Stop (log direct work). `prompt` = per-prompt hook: inject the delegation mode.
 */
export async function runHook(agent, event = 'stop') {
  if (event === 'prompt') return promptHook(agent);
  try {
    if (process.env.TANDEM_MANAGED || spawnedByOtherAgent(agent)) return; // tandem's own or cross-agent CLI runs
    let cfg = DEFAULT_CONFIG;
    try { cfg = loadConfig(); } catch { /* bad config must not break the hook */ }
    const p = JSON.parse((await readStdin()).replace(/^\uFEFF/, '') || '{}');
    if (agent === 'claude') reconcile('claude', p.session_id, p.transcript_path, { cwd: p.cwd, cfg, touch: true });
    else if (agent === 'gemini') reconcile('gemini', p.conversationId, p.transcriptPath, { cwd: p.cwd || p.workspacePaths?.[0], cfg, modelHint: p.modelName, touch: true });
  } catch { /* never break the agent */ } finally {
    // Antigravity requires a JSON decision on stdout; anything but "continue" lets the agent stop.
    if (agent === 'gemini') process.stdout.write('{"decision":"stop"}\n');
  }
}

export const MODE_RESET = 'tandem mode: ask. Earlier tandem mode notes no longer apply: delegate only when the user asks.';

/**
 * What the per-prompt hook injects now, given the key it injected last in this session (pure).
 * Claude: every prompt while free/solo (additionalContext is per turn and compaction can drop it).
 * Gemini: only on change, because PreInvocation fires before *every* model call and its
 * systemMessage persists in the conversation. Both get one reset note when the mode returns to ask.
 */
export function modeInjection(agent, cfg, last, now = Date.now()) {
  const { mode, until } = modeState(cfg, now);
  const key = `${mode}|${until || ''}`;
  if (mode === 'ask') return { key, text: last && last !== key ? MODE_RESET : null };
  return { key, text: agent === 'claude' || last !== key ? modeContext(cfg, agent, now) : null };
}

/** Hook stdout that adds `text` to the lead's context, in each agent's format. */
export function promptHookOutput(agent, text) {
  if (agent === 'gemini') return JSON.stringify(text ? { injectSteps: [{ systemMessage: { systemMessage: text } }] } : {}) + '\n';
  return text ? JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: text } }) + '\n' : '';
}

const modeStatePath = () => path.join(tandemHome(), 'mode-state.json');

async function promptHook(agent) {
  let text = null;
  try {
    // Partners spawned by tandem must not see free mode, or they would delegate straight back.
    if (process.env.TANDEM_MANAGED || spawnedByOtherAgent(agent)) return;
    const p = JSON.parse((await readStdin()).replace(/^﻿/, '') || '{}');
    const session = `${agent}:${(agent === 'claude' ? p.session_id : p.conversationId) || 'unknown'}`;
    let state = {};
    try { state = JSON.parse(readFileSync(modeStatePath(), 'utf8')); } catch { /* first run */ }
    if (!isObj(state)) state = {};
    const inj = modeInjection(agent, loadConfig(), state[session]);
    text = inj.text;
    // Only free/solo sessions need memory; an ask session has no entry (same as "never injected"),
    // so plain ask traffic can't push active sessions out of the pruned file.
    const ask = inj.key === 'ask|';
    if (ask ? Object.hasOwn(state, session) : state[session] !== inj.key) {
      delete state[session]; // re-insert last, so pruning drops the oldest sessions
      if (!ask) state[session] = inj.key;
      const keys = Object.keys(state);
      for (const k of keys.slice(0, Math.max(0, keys.length - 200))) delete state[k];
      mkdirSync(tandemHome(), { recursive: true });
      writeJsonAtomic(modeStatePath(), state);
    }
  } catch { /* never break the agent */ } finally {
    process.stdout.write(promptHookOutput(agent, text));
  }
}

/**
 * Command an agent's hook runner executes. At most one quoted path: Windows `cmd /c` strips the
 * outer quotes of a command that starts with a quote and holds more than two of them.
 */
export function hookCommand(agent, event = null) {
  return `${tandemCommand()} hook ${agent}${event ? ` ${event}` : ''}`;
}

/** How a hook or skill runs tandem: global install if present, else this checkout. */
export function tandemCommand() {
  const global = which('tandem');
  if (global && !isShim(global)) return 'tandem';
  const fwd = (p) => p.replace(/\\/g, '/');
  if (which('node')) return `node "${fwd(BIN)}"`;
  return `"${fwd(process.execPath)}" "${fwd(BIN)}"`;
}

// One tandem hook per Claude event: Stop logs direct work, UserPromptSubmit injects the mode.
const CLAUDE_HOOKS = [
  { event: 'Stop', arg: null, re: /tandem(\.js)?"? hook claude$/ },
  { event: 'UserPromptSubmit', arg: 'prompt', re: /tandem(\.js)?"? hook claude prompt$/ },
];

/** Add or update tandem's hooks in ~/.claude/settings.json (idempotent; one-time backup; atomic write). */
export function installClaudeHook(settingsPath = path.join(os.homedir(), '.claude', 'settings.json')) {
  let s = {};
  if (existsSync(settingsPath)) {
    const text = readFileSync(settingsPath, 'utf8').replace(/^\uFEFF/, '');
    if (text.trim()) s = JSON.parse(text);
    if (!isObj(s)) throw new Error(`${settingsPath} is not a JSON object`);
    const backup = `${settingsPath}.bak-tandem`;
    if (!existsSync(backup)) copyFileSync(settingsPath, backup);
  }
  if (s.hooks === undefined) s.hooks = {};
  if (!isObj(s.hooks)) throw new Error('"hooks" in Claude settings is not an object');
  const results = [];
  for (const { event, arg, re } of CLAUDE_HOOKS) {
    if (s.hooks[event] === undefined) s.hooks[event] = [];
    if (!Array.isArray(s.hooks[event])) throw new Error(`"hooks.${event}" in Claude settings is not an array`);
    const command = hookCommand('claude', arg);
    let found = null;
    for (const g of s.hooks[event]) {
      for (const h of Array.isArray(g?.hooks) ? g.hooks : []) {
        if (!re.test(h?.command || '')) continue;
        if (h.command !== command) {
          h.command = command; // repo moved or install method changed
          found = 'updated';
        } else {
          found ||= 'present'; // never downgrade an earlier stale match's 'updated'
        }
      }
    }
    if (!found) s.hooks[event].push({ hooks: [{ type: 'command', command, timeout: 10 }] });
    results.push(found || 'added');
  }
  if (results.some((r) => r !== 'present')) writeJsonAtomic(settingsPath, s);
  return results.every((r) => r === 'present') ? 'present' : results.includes('added') ? 'added' : 'updated';
}
