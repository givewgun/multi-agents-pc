import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { which, run } from './proc.js';
import { tandemHome, resolveGeminiModel, resolveClaudeModel } from './config.js';

const home = os.homedir();

export function findAgy(cfg = {}) {
  return process.env.TANDEM_AGY || cfg.paths?.agy || which('agy', [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'agy', 'bin', 'agy.exe'),
    path.join(home, '.local', 'bin', 'agy'),
    path.join(home, '.agy', 'bin', 'agy'),
    '/opt/homebrew/bin/agy',
    '/usr/local/bin/agy',
  ]);
}

export function findClaude(cfg = {}) {
  return process.env.TANDEM_CLAUDE || cfg.paths?.claude || which('claude', [
    path.join(home, '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude'),
    path.join(home, '.claude', 'local', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ]);
}

// Windows caps a command line at 32767 chars; leave headroom for the other args.
const MAX_ARGV_PROMPT = 24_000;

export function classifyFailure(text) {
  const t = text.toLowerCase();
  if (/quota|resource_exhausted|rate.?limit|429|usage limit|limit reached/.test(t)) return 'quota';
  if (/authenticat|not logged in|login|oauth|credential/.test(t)) return 'auth';
  return 'error';
}

export function lastJsonLine(stdout) {
  const s = stdout.trim();
  if (!s) return null;
  try { return JSON.parse(s); } catch { /* fall through: tools sometimes print extra lines */ }
  const lines = s.split(/\r?\n/).filter((l) => l.trim().startsWith('{'));
  for (let i = lines.length - 1; i >= 0; i--) {
    try { return JSON.parse(lines[i]); } catch { /* keep looking */ }
  }
  return null;
}

function result(agent, model, fields) {
  return {
    agent, model, ok: false, status: 'error', text: '', sessionId: null,
    usage: { input: 0, output: 0, thinking: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    costUsd: 0, durationMs: 0, turns: 0, denied: [], error: null, stderr: '',
    ...fields,
  };
}

/** Gemini via Antigravity CLI headless mode. No --mode = edits and shell commands soft-denied. */
export async function askGemini(opts, cfg) {
  const { prompt, edit = false, effort, conversation, cwd = process.cwd() } = opts;
  const model = resolveGeminiModel(opts.model || cfg.defaults.geminiModel);
  const timeoutMs = opts.timeoutMs || cfg.timeouts.geminiMs;
  const bin = findAgy(cfg);
  if (!bin) {
    return result('gemini', model, {
      status: 'missing',
      error: 'agy not found. Install Antigravity CLI (https://antigravity.google/docs/install), run `agy` once to sign in.',
    });
  }

  let text = prompt;
  if (text.length > MAX_ARGV_PROMPT) {
    const dir = path.join(tandemHome(), 'prompts');
    mkdirSync(dir, { recursive: true });
    const f = path.join(dir, `${randomUUID()}.md`);
    writeFileSync(f, prompt);
    text = `Read the file ${f} and follow the instructions in it exactly. Reply with your final answer only.`;
  }

  const args = ['-p', text, '--output-format', 'json', '--print-timeout', `${Math.ceil(timeoutMs / 1000)}s`];
  if (edit) args.push('--mode', 'accept-edits');
  if (model) args.push('--model', model);
  if (effort) args.push('--effort', effort);
  if (conversation) args.push('--conversation', conversation);

  const t0 = Date.now();
  const r = await run(bin, args, { cwd, timeoutMs: timeoutMs + 30_000 });
  const durationMs = Date.now() - t0;
  const j = lastJsonLine(r.stdout);
  if (r.timedOut) return result('gemini', model, { status: 'timeout', durationMs, stderr: r.stderr, error: 'timed out' });
  if (!j) {
    return result('gemini', model, {
      status: classifyFailure(r.stderr + r.stdout), durationMs, stderr: r.stderr,
      error: (r.stderr || r.stdout || `agy exited ${r.code}`).trim().slice(0, 2000),
    });
  }
  const u = j.usage || {};
  const denied = (j.denied_actions || []).map((d) => d.action);
  const success = j.status === 'SUCCESS';
  let status = success ? 'ok' : classifyFailure(`${j.error || ''} ${r.stderr}`);
  if (success && !j.response && denied.length) status = 'denied';
  return result('gemini', model, {
    ok: status === 'ok',
    status,
    text: j.response || '',
    sessionId: j.conversation_id || null,
    usage: {
      input: u.input_tokens || 0,
      output: u.output_tokens || 0,
      thinking: u.thinking_tokens || 0,
      cacheRead: u.cache_read_tokens || 0,
      cacheWrite: 0,
      total: u.total_tokens || 0,
    },
    durationMs: Math.round((j.duration_seconds || 0) * 1000) || durationMs,
    turns: j.num_turns || 0,
    denied,
    error: success ? null : (j.error || j.status),
    stderr: r.stderr,
  });
}

/** Claude Code headless mode. Prompt goes via stdin so npm .cmd shims stay shell-safe. */
export async function askClaude(opts, cfg) {
  const { prompt, edit = false, resume, maxTurns = 30, cwd = process.cwd() } = opts;
  const alias = opts.model || cfg.defaults.claudeModel;
  const model = resolveClaudeModel(alias);
  const timeoutMs = opts.timeoutMs || cfg.timeouts.claudeMs;
  const bin = findClaude(cfg);
  if (!bin) return result('claude', model, { status: 'missing', error: 'claude CLI not found (https://claude.com/claude-code)' });

  // Default permission mode in -p: reads allowed, edits/commands denied unless allow-listed.
  const args = ['-p', '--output-format', 'json', '--model', alias, '--max-turns', String(maxTurns)];
  if (edit) args.push('--permission-mode', 'acceptEdits');
  if (resume) args.push('--resume', resume);

  const t0 = Date.now();
  const r = await run(bin, args, { cwd, input: prompt, timeoutMs });
  const durationMs = Date.now() - t0;
  const j = lastJsonLine(r.stdout);
  if (r.timedOut) return result('claude', model, { status: 'timeout', durationMs, stderr: r.stderr, error: 'timed out' });
  if (!j) {
    return result('claude', model, {
      status: classifyFailure(r.stderr + r.stdout), durationMs, stderr: r.stderr,
      error: (r.stderr || r.stdout || `claude exited ${r.code}`).trim().slice(0, 2000),
    });
  }
  const u = j.usage || {};
  const input = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
  const output = u.output_tokens || 0;
  const status = j.is_error ? classifyFailure(String(j.result || j.subtype || '')) : 'ok';
  return result('claude', model, {
    ok: status === 'ok',
    status,
    text: j.is_error ? '' : (j.result || ''),
    sessionId: j.session_id || null,
    usage: {
      input, output, thinking: 0,
      cacheRead: u.cache_read_input_tokens || 0,
      cacheWrite: u.cache_creation_input_tokens || 0,
      total: input + output,
    },
    costUsd: j.total_cost_usd || 0,
    durationMs: j.duration_ms || durationMs,
    turns: j.num_turns || 0,
    denied: (j.permission_denials || []).map((d) => d.tool_name || 'tool'),
    error: j.is_error ? String(j.result || j.subtype) : null,
    stderr: r.stderr,
  });
}

export function ask(agent, opts, cfg) {
  if (agent === 'gemini') return askGemini(opts, cfg);
  if (agent === 'claude') return askClaude(opts, cfg);
  throw new Error(`Unknown agent "${agent}" (use gemini or claude)`);
}
