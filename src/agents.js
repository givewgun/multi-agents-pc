import path from 'node:path';
import os from 'node:os';
import { which, run, isShim } from './proc.js';
import { resolveGeminiModel, resolveClaudeModel } from './config.js';
import { parseClaudeRateLimit } from './usage.js';

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

// Set on every agent tandem spawns; both Stop hooks skip these sessions (already in the ledger).
export const MANAGED_ENV = { TANDEM_MANAGED: '1' };

/** Where each agent keeps the transcript of a session (read by `tandem show`). */
export function transcriptPathFor(agent, sessionId, cwd = process.cwd()) {
  if (!sessionId) return null;
  if (agent === 'claude') {
    // Claude Code: ~/.claude/projects/<cwd with every non-alphanumeric char → "-">/<session>.jsonl
    return path.join(home, '.claude', 'projects', path.resolve(cwd).replace(/[^a-zA-Z0-9]/g, '-'), `${sessionId}.jsonl`);
  }
  return path.join(home, '.gemini', 'antigravity-cli', 'brain', sessionId, '.system_generated', 'logs', 'transcript.jsonl');
}

// Windows caps a command line at 32767 chars; leave headroom for the other args.
const MAX_ARGV_PROMPT = 24_000;

export function classifyFailure(text) {
  const t = text.toLowerCase();
  if (/quota|resource_exhausted|rate.?limit|\b429\b|usage limit|limit reached/.test(t)) return 'quota';
  if (/authenticat|not logged in|login|oauth|credential/.test(t)) return 'auth';
  return 'error';
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Last JSON object in stdout (tools sometimes print extra lines). Non-objects don't count. */
export function lastJsonLine(stdout) {
  const s = stdout.trim();
  if (!s) return null;
  try { const v = JSON.parse(s); if (isObject(v)) return v; } catch { /* fall through */ }
  const lines = s.split(/\r?\n/).filter((l) => l.trim().startsWith('{'));
  for (let i = lines.length - 1; i >= 0; i--) {
    try { const v = JSON.parse(lines[i]); if (isObject(v)) return v; } catch { /* keep looking */ }
  }
  return null;
}

/** From agy stream-json output, the envelope inside the last {"event":"result"} line. */
export function streamResult(stdout) {
  const lines = stdout.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"result"')) continue;
    try {
      const ev = JSON.parse(lines[i]);
      if (ev.event === 'result' && ev.result) return ev.result;
    } catch { /* keep looking */ }
  }
  return null;
}

function result(agent, model, fields) {
  return {
    agent, model, ok: false, status: 'error', text: '', sessionId: null,
    usage: { input: 0, output: 0, thinking: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    costUsd: 0, durationMs: 0, turns: 0, denied: [], error: null, stderr: '', plan: null,
    ...fields,
  };
}

// A single denied action makes headless agy end its turn with an empty answer (seen 3× while
// building v0.2). Say so up front, and retry once in the same conversation if it still happens.
export const headlessNote = (edit) => `[tandem] Headless run: shell commands are unavailable (except read-only git: status, diff, log, show, blame, ls-files). ${edit ? 'Use your file read/edit tools.' : 'This run is read-only: use file read/search tools; edits will be denied.'} If an action is denied, continue without it; never end your turn with an empty answer.\n\n`;

const sumUsage = (a, b) => Object.fromEntries(Object.keys(a).map((k) => [k, (a[k] || 0) + (b[k] || 0)]));

/** Gemini via Antigravity CLI headless mode. No --mode = edits and shell commands soft-denied. */
export async function askGemini(opts, cfg) {
  const note = headlessNote(!!opts.edit);
  const first = await askGeminiOnce({ ...opts, prompt: note + opts.prompt }, cfg);
  if (first.status !== 'denied' || first.text || !first.sessionId || opts.noRetry) return first;
  const retry = await askGeminiOnce({
    ...opts,
    conversation: first.sessionId,
    prompt: `Your previous attempt was blocked (denied: ${first.denied.join(', ') || 'an action'}). ${note}Continue the same task and give your final answer.`,
  }, cfg);
  return {
    ...retry,
    sessionId: retry.sessionId || first.sessionId, // keep the transcript reference if the retry produced no JSON
    usage: sumUsage(first.usage, retry.usage),
    durationMs: first.durationMs + retry.durationMs,
    turns: first.turns + retry.turns,
    denied: [...new Set([...first.denied, ...retry.denied])],
    retried: true,
  };
}

async function askGeminiOnce(opts, cfg) {
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

  // Long prompts exceed the OS command-line limit; send them as one NDJSON event on stdin instead.
  // (A temp file doesn't work: agy denies reads outside the workspace in headless mode.)
  const stream = prompt.length > MAX_ARGV_PROMPT || isShim(bin);
  const args = stream
    ? ['--input-format', 'stream-json', '--output-format', 'stream-json']
    : ['-p', prompt, '--output-format', 'json'];
  args.push('--print-timeout', `${Math.ceil(timeoutMs / 1000)}s`);
  if (edit) args.push('--mode', 'accept-edits');
  if (model) args.push('--model', model);
  if (effort) args.push('--effort', effort);
  if (conversation) args.push('--conversation', conversation);
  // Per-call grants, never saved: extra readable dirs and permission rules (e.g. read_url(example.com)).
  for (const d of opts.addDirs || []) args.push('--add-dir', d);
  if (opts.allow?.length) args.push('--settings', JSON.stringify({ permissions: { allow: opts.allow } }));

  const t0 = Date.now();
  const input = stream ? JSON.stringify({ event: 'user', message: { content: prompt } }) + '\n' : undefined;
  const r = await run(bin, args, { cwd, input, timeoutMs: timeoutMs + 30_000, env: MANAGED_ENV });
  const durationMs = Date.now() - t0;
  const j = stream ? streamResult(r.stdout) : lastJsonLine(r.stdout);
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
  // stream-json (needs --verbose) carries the plan's rate_limit_event next to the usual result.
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--model', alias, '--max-turns', String(maxTurns)];
  if (edit) args.push('--permission-mode', 'acceptEdits');
  if (resume) args.push('--resume', resume);

  const t0 = Date.now();
  const r = await run(bin, args, { cwd, input: prompt, timeoutMs, env: MANAGED_ENV });
  const durationMs = Date.now() - t0;
  const { final: j, plan } = claudeStream(r.stdout);
  if (r.timedOut) return result('claude', model, { status: 'timeout', durationMs, stderr: r.stderr, error: 'timed out', plan });
  if (!j || (r.code !== 0 && typeof j.is_error !== 'boolean')) {
    return result('claude', model, {
      status: plan?.status === 'rejected' ? 'quota' : classifyFailure(r.stderr + r.stdout), durationMs, stderr: r.stderr, plan,
      error: (r.stderr || r.stdout || `claude exited ${r.code}`).trim().slice(-2000),
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
    plan,
  });
}

/** Claude stream-json → final result object (type "result") and latest plan snapshot. */
export function claudeStream(stdout) {
  let final = null;
  let plan = null;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith('{')) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev.type === 'result') final = ev;
    else if (ev.type === 'rate_limit_event') plan = parseClaudeRateLimit(ev) || plan;
  }
  // Older CLIs / plain json output: the whole stdout is the result object.
  return { final: final || lastJsonLine(stdout), plan };
}

export function ask(agent, opts, cfg) {
  if (agent === 'gemini') return askGemini(opts, cfg);
  if (agent === 'claude') return askClaude(opts, cfg);
  throw new Error(`Unknown agent "${agent}" (use gemini or claude)`);
}
