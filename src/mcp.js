// Minimal MCP server (stdio, newline-delimited JSON-RPC 2.0). No SDK dependency.
// Claude Code side: `tandem mcp --expose gemini` → ask_gemini tool.
// Antigravity side: `tandem mcp --expose claude` → ask_claude tool.
import { createInterface } from 'node:readline';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { callAndLog, currentBudget } from './cli.js';
import { tandemHome } from './config.js';
import { getUsage } from './usage.js';
import { route } from './router.js';
import { readRecords, summarize } from './ledger.js';

// The host that loads this server is the lead: exposing Gemini means Claude Code is talking to the user.
export const leadFor = (expose) => (expose === 'gemini' ? 'claude' : expose === 'claude' ? 'gemini' : null);

export function threadsPath() { return path.join(tandemHome(), 'threads.json'); }

export function readThreads() {
  const p = threadsPath();
  if (!existsSync(p)) return {};
  try {
    const v = JSON.parse(readFileSync(p, 'utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}

export function saveThread(thread, agent, sessionId) {
  if (!thread || !sessionId || (agent !== 'claude' && agent !== 'gemini')) return;
  const all = readThreads();
  const entry = Object.hasOwn(all, thread) && all[thread] && typeof all[thread] === 'object' ? { ...all[thread] } : {};
  entry[agent] = sessionId;
  entry.updatedAt = new Date().toISOString();
  all[thread] = entry;
  mkdirSync(tandemHome(), { recursive: true });
  writeFileSync(threadsPath(), JSON.stringify(all, null, 2) + '\n');
}

const SUPPORTED = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const promptProps = {
  prompt: { type: 'string', description: 'Self-contained task. The other agent cannot see this conversation: include goal, files, constraints, and desired output format.' },
  edit: { type: 'boolean', description: 'Allow file edits. Default false (read-only). Commit first so the diff is reviewable.' },
  thread: { type: 'string', description: 'Thread id to group related calls and reuse sessions. Omit to use this MCP server session thread.' },
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

async function callTool(name, a, expose, cfg, defaultThread) {
  const text = (t, isError = false) => ({ content: [{ type: 'text', text: t }], isError });
  if (name === 'route_task') {
    if (typeof a.task !== 'string' || !a.task) return text('task (string) is required', true);
    return text(JSON.stringify(route(a.task, await currentBudget(cfg), { lead: leadFor(expose), pins: cfg.routing?.pins }), null, 2));
  }
  if (name === 'tandem_stats') {
    const s = summarize(readRecords(), cfg, Date.now(), await getUsage(cfg));
    return text(JSON.stringify({ totals: s.totals, savings: s.savings, budget: s.budget }, null, 2));
  }
  const agent = name === 'ask_gemini' ? 'gemini' : name === 'ask_claude' ? 'claude' : null;
  if (!agent || !tools(expose).some((t) => t.name === name)) return text(`Unknown tool ${name}`, true);
  if (typeof a.prompt !== 'string' || !a.prompt) return text('prompt (string) is required', true);
  let model = a.model;
  let category = null;
  if (agent === 'gemini' && !model) {
    const pick = route(a.prompt, await currentBudget(cfg), { pins: cfg.routing?.pins });
    category = pick.category;
    model = pick.agent === 'gemini' ? pick.model : 'neon';
  }
  const thread = typeof a.thread === 'string' && a.thread.trim() ? a.thread.trim() : defaultThread;
  const threads = readThreads();
  const saved = Object.hasOwn(threads, thread) ? threads[thread] : null;
  const conversation = agent === 'gemini' ? (a.conversation_id || saved?.gemini) : undefined;
  const resume = agent === 'claude' ? (a.session_id || saved?.claude) : undefined;
  const { res, rec } = await callAndLog(agent, {
    prompt: a.prompt, model, edit: !!a.edit, conversation, resume,
  }, { from: agent === 'gemini' ? 'claude' : 'gemini', category, tag: 'mcp', lead: leadFor(expose), thread }, cfg);
  if (res.ok && res.sessionId) saveThread(thread, agent, res.sessionId);
  const footer = `\n\n[${res.agent} ${res.model} · ${res.status} · ${Math.round(res.durationMs / 1000)}s · ${res.usage.total} tokens · session ${res.sessionId} · thread ${thread}${res.denied.length ? ` · denied: ${res.denied.join(', ')}` : ''}${agent === 'gemini' ? ` · ≈$${rec.claudeEquivUsd.toFixed(4)} of Claude usage offloaded` : ''}]`;
  if (!res.ok) return text(`${res.agent} failed (${res.status}): ${res.error || 'no output'}${footer}`, true);
  return text(res.text + footer);
}

export function serve(expose, cfg) {
  const defaultThread = `mcp-${randomBytes(4).toString('hex')}`;
  const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
  const rl = createInterface({ input: process.stdin });
  rl.on('line', async (raw) => {
    const line = raw.replace(/^﻿/, ''); // Windows pipes may prepend a BOM
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.method !== 'string') {
      return send({ jsonrpc: '2.0', id: msg?.id ?? null, error: { code: -32600, message: 'Invalid Request' } });
    }
    const { id, method } = msg;
    const params = msg.params && typeof msg.params === 'object' ? msg.params : {};
    if (id === undefined) return; // notification (e.g. notifications/initialized)
    try {
      let result;
      if (method === 'initialize') {
        const v = SUPPORTED.includes(params.protocolVersion) ? params.protocolVersion : SUPPORTED[0];
        result = { protocolVersion: v, capabilities: { tools: {} }, serverInfo: { name: 'tandem', version: '0.1.0' } };
      } else if (method === 'ping') result = {};
      else if (method === 'tools/list') result = { tools: tools(expose) };
      else if (method === 'tools/call') result = await callTool(params.name, params.arguments || {}, expose, cfg, defaultThread);
      else return send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
      send({ jsonrpc: '2.0', id, result });
    } catch (err) {
      send({ jsonrpc: '2.0', id, error: { code: -32603, message: err.message } });
    }
  });
  return new Promise((resolve) => rl.on('close', resolve));
}
