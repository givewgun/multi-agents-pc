// Minimal MCP server (stdio, newline-delimited JSON-RPC 2.0). No SDK dependency.
// Claude Code side: `tandem mcp --expose gemini` → ask_gemini tool.
// Antigravity side: `tandem mcp --expose claude` → ask_claude tool.
import { createInterface } from 'node:readline';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { callAndLog, currentBudget } from './cli.js';
import { tandemHome, loadConfig } from './config.js';
import { shellDeniedHint } from './agents.js';
import { sweep } from './hooks.js';
import { getUsage } from './usage.js';
import { route, CATEGORIES, checkCategory } from './router.js';
import { readRecords, summarize } from './ledger.js';
import { VERSION } from './version.js';

// The host that loads this server is the lead: exposing Gemini means Claude Code is talking to the user.
export const leadFor = (expose) => (expose === 'gemini' ? 'claude' : expose === 'claude' ? 'gemini' : null);

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function normCwd(cwd = process.cwd()) {
  const resolved = path.resolve(cwd);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function threadKey(thread, cwd = process.cwd()) {
  return `${normCwd(cwd)}\u0000${thread}`;
}

function resolveThread(raw, defaultThread) {
  const t = typeof raw === 'string' ? raw.trim() : '';
  return t && !UNSAFE_KEYS.has(t) ? t : defaultThread;
}

export function threadsPath() { return path.join(tandemHome(), 'threads.json'); }

export function readThreads() {
  const out = Object.create(null);
  const p = threadsPath();
  if (!existsSync(p)) return out;
  try {
    const v = JSON.parse(readFileSync(p, 'utf8'));
    if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
    for (const [k, val] of Object.entries(v)) {
      if (UNSAFE_KEYS.has(k)) continue;
      if (val && typeof val === 'object' && !Array.isArray(val)) out[k] = val;
    }
    return out;
  } catch { return out; }
}

export function saveThread(thread, agent, sessionId, cwd = process.cwd()) {
  if (typeof thread !== 'string' || !thread || UNSAFE_KEYS.has(thread) || !sessionId || (agent !== 'claude' && agent !== 'gemini')) return;
  const all = readThreads();
  const resolvedCwd = path.resolve(cwd);
  const key = threadKey(thread, resolvedCwd);
  const entry = Object.hasOwn(all, key) && all[key] && typeof all[key] === 'object' ? { ...all[key] } : {};
  entry[agent] = sessionId;
  // Sessions live per project folder (Claude stores them by cwd), so remember where this one is.
  entry.cwd = resolvedCwd;
  entry.updatedAt = new Date().toISOString();
  all[key] = entry;
  mkdirSync(tandemHome(), { recursive: true });
  const p = threadsPath();
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(all, null, 2) + '\n');
  renameSync(tmp, p);
}

const SUPPORTED = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const promptProps = {
  prompt: { type: 'string', description: 'Self-contained task. The other agent cannot see this conversation: include goal, files, constraints, and desired output format.' },
  cwd: { type: 'string', description: 'Absolute path to the project/workspace directory to run in. Always pass your active workspace path when calling from a global or plugin MCP server.' },
  edit: { type: 'boolean', description: 'Allow file edits. Default false (read-only). Commit first so the diff is reviewable.' },
  thread: { type: 'string', description: 'Thread id to group related calls and reuse sessions. Omit to use this MCP server session thread.' },
  category: { type: 'string', enum: CATEGORIES, description: 'Your classification of this task (you have read it; tandem\'s keyword rules have not). Picks the model when `model` is omitted and labels the call in the ledger.' },
};

function tools(expose) {
  const list = [];
  if (expose === 'gemini' || expose === 'both') {
    list.push({
      name: 'ask_gemini',
      description: 'Delegate to Gemini (Google Antigravity) to save Claude usage: reading many files, codebase summaries, web research with Google Search, boilerplate/tests, first-pass review, second opinions. Returns Gemini\'s answer.',
      inputSchema: {
        type: 'object',
        properties: {
          ...promptProps,
          model: { type: 'string', description: 'flash (trivial) | hydrogen (boilerplate/tests) | orchestrator (a Gemini model: Neon plans, Hydrogen executes — not the team lead) | neon (hard reasoning/review) | neon-high | any agy slug. Omit to let tandem route.' },
          conversation_id: { type: 'string', description: 'Continue a previous Gemini conversation (overrides the thread\'s saved conversation).' },
        },
        required: ['prompt'],
      },
    });
  }
  if (expose === 'claude' || expose === 'both') {
    list.push({
      name: 'ask_claude',
      description: 'Ask Claude (Claude Code) for final code review, hard debugging, or architecture decisions. Uses the user\'s Claude limits: call sparingly, send diffs/summaries instead of file dumps, and batch questions into one call.',
      inputSchema: {
        type: 'object',
        properties: {
          ...promptProps,
          model: { type: 'string', description: 'haiku | sonnet (default) | opus (genuinely hard problems only).' },
          session_id: { type: 'string', description: 'Resume a previous Claude session (overrides the thread\'s saved session).' },
        },
        required: ['prompt'],
      },
    });
  }
  list.push(
    {
      name: 'route_task',
      description: 'Recommend which agent (claude/gemini) and model should do a task, using tandem\'s cost-aware rules and current budget. Spends no tokens.',
      inputSchema: { type: 'object', properties: { task: { type: 'string' } }, required: ['task'] },
    },
    {
      name: 'tandem_stats',
      description: 'Usage, savings and budget status for Claude and Gemini this week.',
      inputSchema: { type: 'object', properties: {} },
    },
  );
  return list;
}

// Calls in one thread must run in order: the second reuses the session the first one saves.
const threadQueues = new Map();
function inThreadOrder(thread, fn) {
  const prev = threadQueues.get(thread) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  threadQueues.set(thread, next);
  next.finally(() => { if (threadQueues.get(thread) === next) threadQueues.delete(thread); }).catch(() => {});
  return next;
}

function isExistingDir(p) {
  try { return existsSync(p) && statSync(p).isDirectory(); } catch { return false; }
}

const PLUGIN_DIR_RE = /[\\/]\.gemini[\\/]config[\\/]plugins[\\/]/i;

async function resolveWorkDir(rawCwd, getClientRoot) {
  if (rawCwd !== undefined && rawCwd !== null && rawCwd !== '') {
    if (typeof rawCwd !== 'string') throw new Error('cwd must be a string path');
    const resolved = path.resolve(rawCwd);
    if (!isExistingDir(resolved)) throw new Error(`cwd is not an existing directory: ${rawCwd}`);
    return { cwd: resolved, explicit: true };
  }
  if (getClientRoot) {
    const rootDir = await getClientRoot();
    if (rootDir && isExistingDir(rootDir)) return { cwd: path.resolve(rootDir), explicit: true };
  }
  return { cwd: process.cwd(), explicit: false };
}

async function callTool(name, a, expose, cfg, defaultThread, getClientRoot) {
  if (name !== 'ask_gemini' && name !== 'ask_claude') return callToolNow(name, a, expose, cfg, defaultThread, getClientRoot);
  const thread = resolveThread(a.thread, defaultThread);
  return inThreadOrder(thread, () => callToolNow(name, a, expose, cfg, defaultThread, getClientRoot));
}

async function callToolNow(name, a, expose, _cfg, defaultThread, getClientRoot) {
  const text = (t, isError = false) => ({ content: [{ type: 'text', text: t }], isError });
  const liveCfg = loadConfig();
  if (name === 'route_task') {
    if (typeof a.task !== 'string' || !a.task) return text('task (string) is required', true);
    try {
      return text(JSON.stringify(route(a.task, await currentBudget(liveCfg), { lead: leadFor(expose), pins: liveCfg.routing?.pins, category: a.category }), null, 2));
    } catch (err) {
      return text(err.message, true);
    }
  }
  if (name === 'tandem_stats') {
    sweep(liveCfg);
    const s = summarize(readRecords(), liveCfg, Date.now(), await getUsage(liveCfg));
    return text(JSON.stringify({ totals: s.totals, savings: s.savings, budget: s.budget }, null, 2));
  }
  const agent = name === 'ask_gemini' ? 'gemini' : name === 'ask_claude' ? 'claude' : null;
  if (!agent || !tools(expose).some((t) => t.name === name)) return text(`Unknown tool ${name}`, true);
  if (typeof a.prompt !== 'string' || !a.prompt) return text('prompt (string) is required', true);
  let workDir;
  let explicitCwd;
  try {
    ({ cwd: workDir, explicit: explicitCwd } = await resolveWorkDir(a.cwd, getClientRoot));
  } catch (err) {
    return text(err.message, true);
  }
  let model = a.model;
  let category;
  try {
    category = checkCategory(a.category);
  } catch (err) {
    return text(err.message, true);
  }
  if (!model) {
    const pick = route(a.prompt, await currentBudget(liveCfg), { pins: liveCfg.routing?.pins, lead: leadFor(expose), category });
    category = pick.category;
    const fallback = agent === 'gemini' ? liveCfg.defaults.geminiModel : liveCfg.defaults.claudeModel;
    model = pick.agent === agent ? pick.model : fallback;
  }
  const thread = resolveThread(a.thread, defaultThread);
  const curCwd = normCwd(workDir);
  const key = threadKey(thread, curCwd);
  const threads = readThreads();
  const entry = Object.hasOwn(threads, key) ? threads[key] : null;
  // Thread names are free text; only reuse a session saved from this same project folder.
  const saved = entry && (!entry.cwd || (typeof entry.cwd === 'string' && normCwd(entry.cwd) === curCwd)) ? entry : null;
  const conversation = agent === 'gemini' ? (a.conversation_id || saved?.gemini) : undefined;
  const resume = agent === 'claude' ? (a.session_id || saved?.claude) : undefined;
  const meta = { from: agent === 'gemini' ? 'claude' : 'gemini', category, tag: 'mcp', lead: leadFor(expose), thread, cwd: workDir };
  const opts = { prompt: a.prompt, model, edit: !!a.edit, conversation, resume, cwd: workDir };
  let { res, rec } = await callAndLog(agent, opts, meta, liveCfg);
  // A saved session can disappear (deleted, other machine); retry fresh rather than fail.
  const reused = (agent === 'claude' && resume && !a.session_id) || (agent === 'gemini' && conversation && !a.conversation_id);
  if (!res.ok && res.status === 'error' && reused) {
    ({ res, rec } = await callAndLog(agent, { ...opts, conversation: undefined, resume: undefined }, meta, liveCfg));
  }
  if (res.ok && res.sessionId) saveThread(thread, agent, res.sessionId, workDir);
  const pluginNote = !explicitCwd && PLUGIN_DIR_RE.test(workDir) ? ' · note: ran in plugin dir; pass cwd for workspace access' : '';
  const footer = `\n\n[${res.agent} ${res.model} · ${res.status} · ${Math.round(res.durationMs / 1000)}s · ${res.usage.total} tokens · session ${res.sessionId} · thread ${thread}${res.denied.length ? ` · denied: ${res.denied.join(', ')}` : ''}${shellDeniedHint(res.denied, liveCfg) ? ` · ${shellDeniedHint(res.denied, liveCfg)}` : ''}${agent === 'gemini' ? ` · ≈$${rec.claudeEquivUsd.toFixed(4)} of Claude usage offloaded` : ''}${pluginNote}]`;
  if (!res.ok) return text(`${res.agent} failed (${res.status}): ${res.error || 'no output'}${footer}`, true);
  return text(res.text + footer);
}

export function serve(expose, cfg) {
  const defaultThread = `mcp-${randomBytes(4).toString('hex')}`;
  const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
  const rl = createInterface({ input: process.stdin });
  let clientSupportsRoots = false;
  let nextReqId = 1;
  const pendingClient = new Map();

  const requestClientRoot = () => {
    if (!clientSupportsRoots) return Promise.resolve(null);
    return new Promise((resolve) => {
      const id = `tandem-roots-${nextReqId++}`;
      const timer = setTimeout(() => {
        pendingClient.delete(id);
        resolve(null);
      }, 2000);
      timer.unref?.();
      pendingClient.set(id, {
        resolve: (res) => {
          clearTimeout(timer);
          const roots = Array.isArray(res?.roots) ? res.roots : [];
          for (const r of roots) {
            if (typeof r?.uri === 'string' && r.uri.startsWith('file:')) {
              try {
                const dir = fileURLToPath(r.uri);
                if (isExistingDir(dir)) return resolve(dir);
              } catch { /* next root */ }
            }
          }
          resolve(null);
        },
        reject: () => {
          clearTimeout(timer);
          resolve(null);
        },
      });
      send({ jsonrpc: '2.0', id, method: 'roots/list', params: {} });
    });
  };

  rl.on('line', async (raw) => {
    const line = raw.replace(/^﻿/, ''); // Windows pipes may prepend a BOM
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
    if (msg && typeof msg === 'object' && !Array.isArray(msg) && msg.method === undefined && msg.id !== undefined && (Object.hasOwn(msg, 'result') || Object.hasOwn(msg, 'error'))) {
      const waiter = pendingClient.get(msg.id);
      if (waiter) {
        pendingClient.delete(msg.id);
        if (msg.error) waiter.reject(msg.error);
        else waiter.resolve(msg.result);
      }
      return;
    }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.method !== 'string') {
      return send({ jsonrpc: '2.0', id: msg?.id ?? null, error: { code: -32600, message: 'Invalid Request' } });
    }
    const { id, method } = msg;
    const params = msg.params && typeof msg.params === 'object' ? msg.params : {};
    if (id === undefined) return; // notification (e.g. notifications/initialized)
    try {
      let result;
      if (method === 'initialize') {
        clientSupportsRoots = Boolean(params.capabilities?.roots);
        const v = SUPPORTED.includes(params.protocolVersion) ? params.protocolVersion : SUPPORTED[0];
        result = { protocolVersion: v, capabilities: { tools: {} }, serverInfo: { name: 'tandem', version: VERSION } };
      } else if (method === 'ping') result = {};
      else if (method === 'tools/list') result = { tools: tools(expose) };
      else if (method === 'tools/call') result = await callTool(params.name, params.arguments || {}, expose, cfg, defaultThread, requestClientRoot);
      else return send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
      send({ jsonrpc: '2.0', id, result });
    } catch (err) {
      send({ jsonrpc: '2.0', id, error: { code: -32603, message: err.message } });
    }
  });
  return new Promise((resolve) => rl.on('close', () => {
    for (const waiter of pendingClient.values()) waiter.reject(new Error('closed'));
    pendingClient.clear();
    resolve();
  }));
}
