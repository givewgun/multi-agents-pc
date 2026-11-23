// Minimal MCP server (stdio, newline-delimited JSON-RPC 2.0). No SDK dependency.
// Claude Code side: `tandem mcp --expose gemini` → ask_gemini tool.
// Antigravity side: `tandem mcp --expose claude` → ask_claude tool.
import { createInterface } from 'node:readline';
import { callAndLog, currentBudget } from './cli.js';
import { getUsage } from './usage.js';
import { route } from './router.js';
import { readRecords, summarize } from './ledger.js';

// The host that loads this server is the lead: exposing Gemini means Claude Code is talking to the user.
export const leadFor = (expose) => (expose === 'gemini' ? 'claude' : expose === 'claude' ? 'gemini' : null);

const SUPPORTED = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const promptProps = {
  prompt: { type: 'string', description: 'Self-contained task. The other agent cannot see this conversation: include goal, files, constraints, and desired output format.' },
  edit: { type: 'boolean', description: 'Allow file edits. Default false (read-only). Commit first so the diff is reviewable.' },
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
          model: { type: 'string', description: 'flash (trivial) | hydrogen (boilerplate/tests) | orchestrator (multi-file features) | neon (hard reasoning/review) | neon-high | any agy slug. Omit to let tandem route.' },
          conversation_id: { type: 'string', description: 'Continue a previous Gemini conversation.' },
        },
        required: ['prompt'],
      },
    });
  }
  if (expose === 'claude' || expose === 'both') {
    list.push({
      name: 'ask_claude',
      description: 'Ask Claude (Claude Code) for final code review, hard debugging, or architecture decisions. Uses the user\'s Claude limits: call sparingly.',
      inputSchema: {
        type: 'object',
        properties: {
          ...promptProps,
          model: { type: 'string', description: 'haiku | sonnet (default) | opus (genuinely hard problems only).' },
          session_id: { type: 'string', description: 'Resume a previous Claude session.' },
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

async function callTool(name, a, expose, cfg) {
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
  const { res, rec } = await callAndLog(agent, {
    prompt: a.prompt, model, edit: !!a.edit, conversation: a.conversation_id, resume: a.session_id,
  }, { from: agent === 'gemini' ? 'claude' : 'gemini', category, tag: 'mcp', lead: leadFor(expose) }, cfg);
  const footer = `\n\n[${res.agent} ${res.model} · ${res.status} · ${Math.round(res.durationMs / 1000)}s · ${res.usage.total} tokens · session ${res.sessionId}${res.denied.length ? ` · denied: ${res.denied.join(', ')}` : ''}${agent === 'gemini' ? ` · ≈$${rec.claudeEquivUsd.toFixed(4)} of Claude usage offloaded` : ''}]`;
  if (!res.ok) return text(`${res.agent} failed (${res.status}): ${res.error || 'no output'}${footer}`, true);
  return text(res.text + footer);
}

export function serve(expose, cfg) {
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
      else if (method === 'tools/call') result = await callTool(params.name, params.arguments || {}, expose, cfg);
      else return send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
      send({ jsonrpc: '2.0', id, result });
    } catch (err) {
      send({ jsonrpc: '2.0', id, error: { code: -32603, message: err.message } });
    }
  });
  return new Promise((resolve) => rl.on('close', resolve));
}
