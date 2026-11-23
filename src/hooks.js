// Stop hooks: count the work the user does *directly* with an agent, so the ledger shows both
// agents' real contribution (ADR 0010). Each run reads only the transcript bytes added since the
// last run. Hooks must be fast and must never fail the agent: every error is swallowed.
import { readFileSync, writeFileSync, mkdirSync, existsSync, openSync, readSync, fstatSync, closeSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { tandemHome } from './config.js';
import { makeRecord, appendRecord, claudeEquivalentUsd } from './ledger.js';
import { which, isShim } from './proc.js';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'tandem.js');
const statePath = () => path.join(tandemHome(), 'hook-state.json');

function readState() {
  try { return JSON.parse(readFileSync(statePath(), 'utf8')); } catch { return {}; }
}

function writeState(s) {
  mkdirSync(tandemHome(), { recursive: true });
  writeFileSync(statePath(), JSON.stringify(s));
}

/** Complete lines appended to `file` since byte `offset`; returns {lines, offset}. */
export function readNewLines(file, offset = 0) {
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    if (size < offset) offset = 0; // file was rewritten
    const buf = Buffer.alloc(size - offset);
    readSync(fd, buf, 0, buf.length, offset);
    const end = buf.lastIndexOf(0x0a); // only whole lines; a half-written one waits for next run
    if (end === -1) return { lines: [], offset };
    return { lines: buf.subarray(0, end).toString('utf8').split('\n'), offset: offset + end + 1 };
  } finally { closeSync(fd); }
}

const parse = (l) => { try { return JSON.parse(l); } catch { return null; } };

/** Claude Code transcript lines → usage. Streamed messages repeat their usage per content block, so the last line per message id wins. */
export function claudeUsage(lines) {
  const byId = new Map();
  for (const l of lines) {
    const o = parse(l);
    const m = o?.type === 'assistant' ? o.message : null;
    if (m?.usage) byId.set(m.id || `${byId.size}`, { model: m.model, u: m.usage });
  }
  const usage = { input: 0, output: 0, thinking: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
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
  const usage = { input: 0, output: 0, thinking: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
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

function logSession(agent, sessionId, transcriptPath, cwd, cfg, modelHint) {
  if (!sessionId || !transcriptPath || !existsSync(transcriptPath)) return null;
  const state = readState();
  state[agent] ||= {};
  const prev = state[agent][sessionId]?.offset || 0;
  const { lines, offset } = readNewLines(transcriptPath, prev);
  state[agent][sessionId] = { offset, at: new Date().toISOString() };
  writeState(state);
  const { usage, model, turns } = agent === 'claude' ? claudeUsage(lines) : geminiUsage(lines, modelHint);
  if (!usage.total) return null;
  const costUsd = agent === 'claude' ? claudeEquivalentUsd(usage, cfg.pricing, model) : 0;
  const res = {
    agent, model, ok: true, status: 'ok', text: '', sessionId, usage, costUsd, durationMs: 0, turns,
    denied: [], error: null, plan: null, transcriptPath,
  };
  return appendRecord(makeRecord(res, { from: 'user', tag: 'interactive', lead: agent, cwd: cwd || process.cwd() }, cfg));
}

async function readStdin() {
  if (process.stdin.isTTY) return '';
  process.stdin.setEncoding('utf8');
  let s = '';
  for await (const chunk of process.stdin) s += chunk;
  return s;
}

/** `tandem hook claude|gemini` — called by each agent's Stop hook with the event JSON on stdin. */
export async function runHook(agent, cfg) {
  try {
    if (process.env.TANDEM_MANAGED) return; // tandem's own calls are already in the ledger
    const p = JSON.parse((await readStdin()).replace(/^﻿/, '') || '{}');
    if (agent === 'claude') logSession('claude', p.session_id, p.transcript_path, p.cwd, cfg);
    else if (agent === 'gemini') logSession('gemini', p.conversationId, p.transcriptPath, p.cwd || p.workspacePaths?.[0], cfg, p.modelName);
  } catch { /* never break the agent */ } finally {
    // Antigravity requires a JSON decision on stdout; anything but "continue" lets the agent stop.
    if (agent === 'gemini') process.stdout.write('{"decision":"stop"}\n');
  }
}

/** Command string an agent should run for the hook. Forward slashes work in cmd, PowerShell and bash. */
export function hookCommand(agent) {
  const global = which('tandem');
  if (global && !isShim(global)) return `tandem hook ${agent}`;
  const q = (p) => `"${p.replace(/\\/g, '/')}"`;
  return `${q(process.execPath)} ${q(BIN)} hook ${agent}`;
}

/** Add the Stop hook to ~/.claude/settings.json (idempotent, backs up the file once). */
export function installClaudeHook(settingsPath = path.join(os.homedir(), '.claude', 'settings.json')) {
  let s = {};
  if (existsSync(settingsPath)) {
    const text = readFileSync(settingsPath, 'utf8').replace(/^﻿/, '');
    if (text.trim()) s = JSON.parse(text);
    const backup = `${settingsPath}.bak-tandem`;
    if (!existsSync(backup)) copyFileSync(settingsPath, backup);
  }
  s.hooks ||= {};
  s.hooks.Stop ||= [];
  const command = hookCommand('claude');
  const present = s.hooks.Stop.some((g) => (g.hooks || []).some((h) => /tandem(\.js)?"? hook claude/.test(h.command || '')));
  if (present) return 'present';
  s.hooks.Stop.push({ hooks: [{ type: 'command', command, timeout: 10 }] });
  mkdirSync(path.dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(s, null, 2) + '\n');
  return 'added';
}
