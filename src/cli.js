import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadConfig, setConfigValue, configPath, readUserConfig } from './config.js';
import { ask } from './agents.js';
import { makeRecord, appendRecord, readRecords, summarize, ledgerPath, planBudget } from './ledger.js';
import { getUsage, storeSnapshot } from './usage.js';
import { route } from './router.js';
import { usd, tok, ms, pct, c, bar, table } from './format.js';

const BOOL = new Set(['edit', 'json', 'force', 'mcp', 'open', 'no-fallback', 'staged', 'help', 'quiet', 'dry-run', 'live', 'global', 'refresh-claude']);

export function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { out._.push(...argv.slice(i + 1)); break; }
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split(/=(.*)/s);
      if (v !== undefined && BOOL.has(k)) {
        if (v !== 'true' && v !== 'false') throw new Error(`--${k} takes true or false, got "${v}"`);
        out.flags[k] = v === 'true';
      } else if (v !== undefined) out.flags[k] = v;
      else if (BOOL.has(k)) out.flags[k] = true;
      else out.flags[k] = argv[++i];
    } else if (a === '-h') out.flags.help = true;
    else out._.push(a);
  }
  return out;
}

/** "a;b" â†’ ["a","b"] (semicolon: paths and rules can contain commas). */
const list = (v) => (v ? String(v).split(';').map((s) => s.trim()).filter(Boolean) : []);

function parseDuration(s) {
  if (!s) return undefined;
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(String(s));
  if (!m) throw new Error(`Bad duration "${s}" (use e.g. 90s, 15m)`);
  return Number(m[1]) * { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[m[2] || 's'];
}

async function readStdin() {
  if (process.stdin.isTTY) return '';
  process.stdin.setEncoding('utf8'); // decode across chunk boundaries
  let s = '';
  for await (const chunk of process.stdin) s += chunk;
  return s;
}

async function promptFrom(rest, flags) {
  if (flags.file) return readFileSync(flags.file, 'utf8');
  if (rest.length) return rest.join(' ');
  return (await readStdin()).trim();
}

/** Call an agent and log it. Shared by CLI, MCP server and bench. */
export async function callAndLog(agent, opts, meta, cfg) {
  const res = await ask(agent, opts, cfg);
  if (res.plan) storeSnapshot(res.agent, res.plan); // free Claude plan-usage reading
  const rec = appendRecord(makeRecord(res, { promptChars: opts.prompt.length, cwd: opts.cwd, ...meta }, cfg));
  return { res, rec };
}

/** Plan usage vs. limits right now (refreshes Gemini's free reading when stale). */
export async function currentBudget(cfg, records = readRecords()) {
  return planBudget(await getUsage(cfg), cfg, records);
}

function printResult(res, rec, flags) {
  if (flags.json) { process.stdout.write(JSON.stringify({ ...res, stderr: undefined, record: rec }, null, 2) + '\n'); return; }
  if (res.text) process.stdout.write(res.text.trimEnd() + '\n');
  if (res.denied.length) process.stderr.write(c.yellow(`! denied: ${res.denied.join(', ')} â€” use --edit for edits; shell commands need agent allow-rules\n`));
  if (!res.ok) process.stderr.write(c.red(`âœ— ${res.agent} ${res.status}: ${res.error || ''}\n`));
  const saved = res.agent === 'gemini' ? ` Â· savedâ‰ˆ${usd(rec.claudeEquivUsd)} vs ${loadConfig().savingsBaseline}` : ` Â· costâ‰ˆ${usd(rec.costUsd)}`;
  process.stderr.write(c.dim(`[${res.agent} ${res.model} Â· ${res.status} Â· ${ms(res.durationMs)} Â· ${tok(res.usage.total)} tok${saved} Â· session ${res.sessionId}]\n`));
}

function exitFor(res) { process.exitCode = res.ok ? 0 : res.status === 'denied' ? 3 : 1; }

async function cmdAsk(rest, flags, cfg) {
  const [agent, ...words] = rest;
  if (!['gemini', 'claude'].includes(agent)) throw new Error('Usage: tandem ask <gemini|claude> "prompt" [--model m] [--edit] [--file f]');
  const prompt = await promptFrom(words, flags);
  if (!prompt) throw new Error('Empty prompt');
  const { res, rec } = await callAndLog(agent, {
    prompt, model: flags.model, edit: !!flags.edit, effort: flags.effort,
    conversation: flags.continue, resume: flags.continue, cwd: flags.cwd,
    timeoutMs: parseDuration(flags.timeout), maxTurns: flags['max-turns'] ? Number(flags['max-turns']) : undefined,
    addDirs: list(flags['add-dir']), allow: list(flags.allow),
  }, { from: flags.from || process.env.TANDEM_CALLER || 'user', tag: flags.tag }, cfg);
  printResult(res, rec, flags);
  exitFor(res);
}

async function cmdRoute(rest, flags, cfg) {
  const task = await promptFrom(rest, flags);
  const pick = route(task, await currentBudget(cfg), { pins: cfg.routing?.pins, lead: flags.lead });
  if (flags.json) return void process.stdout.write(JSON.stringify(pick, null, 2) + '\n');
  console.log(`${c.bold(pick.agent)} ${c.cyan(pick.model)}  ${c.dim(`[${pick.category}, confidence ${pct(pick.confidence)}]`)}`);
  console.log(pick.reason);
  for (const n of pick.notes) console.log(c.yellow(`! ${n}`));
  if (pick.alternatives.length) console.log(c.dim(`alternatives: ${pick.alternatives.map((a) => `${a.agent}/${a.model} (${a.category})`).join(', ')}`));
}

async function cmdRun(rest, flags, cfg) {
  const prompt = await promptFrom(rest, flags);
  if (!prompt) throw new Error('Usage: tandem run "task" [--edit] [--no-fallback]');
  const pick = route(prompt, await currentBudget(cfg), { pins: cfg.routing?.pins, lead: flags.lead });
  const model = flags.model || pick.model;
  process.stderr.write(c.dim(`â†’ ${pick.agent}/${model} (${pick.category}): ${pick.reason}\n`));
  for (const n of pick.notes) process.stderr.write(c.yellow(`! ${n}\n`));
  const meta = { from: flags.from || 'user', category: pick.category, tag: flags.tag };
  const opts = { prompt, model, edit: !!flags.edit, cwd: flags.cwd, timeoutMs: parseDuration(flags.timeout) };
  let { res, rec } = await callAndLog(pick.agent, opts, meta, cfg);
  if (!res.ok && res.status !== 'denied' && !flags['no-fallback']) {
    const other = pick.agent === 'gemini' ? 'claude' : 'gemini';
    const otherModel = other === 'claude' ? 'sonnet' : 'neon';
    process.stderr.write(c.yellow(`! ${pick.agent} ${res.status}; falling back to ${other}/${otherModel}\n`));
    ({ res, rec } = await callAndLog(other, { ...opts, model: otherModel }, { ...meta, tag: 'fallback' }, cfg));
  }
  printResult(res, rec, flags);
  exitFor(res);
}

const REVIEW_PROMPT = (diff, extra) => `You are reviewing a code change. Report only real problems: bugs, security issues, broken edge cases, missing error handling that matters. No style nits, no praise.
Format: one bullet per finding, "path:line â€” problem â€” fix". If nothing is wrong, reply exactly "LGTM".
${extra ? `Context from the author: ${extra}\n` : ''}
<diff>
${diff}
</diff>`;

async function cmdReview(rest, flags, cfg) {
  if (flags.staged && flags.base) throw new Error('Use either --staged or --base, not both');
  if (flags.base && String(flags.base).startsWith('-')) throw new Error(`Invalid --base "${flags.base}"`);
  const gitArgs = ['diff', '--no-color', '--no-ext-diff'];
  if (flags.staged) gitArgs.push('--staged');
  if (flags.base) gitArgs.push(`${flags.base}...HEAD`, '--');
  const diff = execFileSync('git', gitArgs, { cwd: flags.cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (!diff.trim()) { console.log('No changes to review.'); return; }
  const who = flags.agent || 'gemini';
  const agents = who === 'both' ? ['gemini', 'claude'] : [who];
  const prompt = REVIEW_PROMPT(diff, rest.join(' '));
  const runs = await Promise.all(agents.map((a) => callAndLog(a, {
    prompt, model: a === 'gemini' ? (flags['gemini-model'] || 'neon') : (flags['claude-model'] || 'sonnet'), cwd: flags.cwd,
  }, { from: 'user', category: 'review', tag: flags.tag }, cfg)));
  if (flags.json) {
    process.stdout.write(JSON.stringify(runs.map(({ res, rec }) => ({ ...res, stderr: undefined, record: rec })), null, 2) + '\n');
  } else {
    for (const { res, rec } of runs) {
      if (agents.length > 1) console.log(c.bold(`\nâ”€â”€ ${res.agent} (${res.model}) â”€â”€`));
      printResult(res, rec, flags);
    }
  }
  process.exitCode = runs.every((r) => r.res.ok) ? 0 : 1;
}

async function cmdStats(rest, flags, cfg) {
  const s = summarize(readRecords(), cfg, Date.now(), await getUsage(cfg));
  if (flags.json) return void process.stdout.write(JSON.stringify({ ...s, recent: undefined }, null, 2) + '\n');
  const { claude, gemini } = s.totals;
  console.log(c.bold('Calls'));
  console.log(table([
    ['claude', claude.calls, claude.ok, tok(claude.tokens), usd(claude.costUsd), ms(claude.calls ? claude.durationMs / claude.calls : null)],
    ['gemini', gemini.calls, gemini.ok, tok(gemini.tokens), usd(0) + c.dim(' (subscription)'), ms(gemini.calls ? gemini.durationMs / gemini.calls : null)],
  ], ['agent', 'calls', 'ok', 'tokens', 'api-equiv cost', 'avg time']));
  console.log('\n' + c.bold('By model'));
  console.log(table(Object.entries(s.byModel).sort((a, b) => b[1].calls - a[1].calls)
    .map(([m, b]) => [m, b.calls, pct(b.calls ? b.ok / b.calls : null), tok(b.tokens), usd(b.claudeEquivUsd)]),
  ['model', 'calls', 'ok%', 'tokens', 'claude-equiv']));
  const sv = s.savings;
  console.log('\n' + c.bold('Savings') + c.dim(` (Gemini work priced at ${sv.baseline})`));
  console.log(`  this week: ${c.green(usd(sv.offloadedWeekUsd))} offloaded Â· Claude spent ${usd(sv.claudeWeekUsd)} Â· Gemini share ${pct(sv.offloadShareWeek)}`);
  console.log(`  all time:  ${c.green(usd(sv.offloadedAllUsd))} offloaded` + (sv.geminiMonthlyUsd ? ` Â· Gemini plan ${usd(sv.geminiMonthlyUsd)}/mo` : ''));
  printBudget(s.budget);
}

function resetsIn(iso) {
  if (!iso) return '';
  const m = Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 60_000));
  return c.dim(`resets in ${m >= 1440 ? `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h` : `${Math.floor(m / 60)}h ${m % 60}m`}`);
}

const age = (ms) => (ms == null ? '' : ms < 60_000 ? 'just now' : ms < 3_600_000 ? `${Math.round(ms / 60_000)}m ago` : `${Math.round(ms / 3_600_000)}h ago`);

function printBudget(b) {
  console.log('\n' + c.bold('Plan usage') + c.dim('  (bar fills up to tandem\'s limit for that window)'));
  for (const [name, s] of [['Claude', b.claude], ['Gemini', b.gemini]]) {
    if (!s.known) {
      console.log(`  ${name.padEnd(7)} ${c.dim(name === 'Claude' ? 'unknown until tandem makes a Claude call (or run: tandem usage --refresh-claude)' : 'unknown (agy not found?)')}`);
      continue;
    }
    for (const [label, w, lim] of [['5h  ', s.fiveHour, s.limits.fiveHour], ['week', s.weekly, s.limits.weekly]]) {
      if (!w) continue;
      console.log(`  ${name.padEnd(7)}${label}  ${bar(w.used / lim, 20, false)}  ${pct(w.used).padStart(4)} of plan Â· limit ${pct(lim)}  ${resetsIn(w.resetsAt)}`);
    }
    console.log(c.dim(`          from ${s.source}, ${age(s.ageMs)}${s.status && s.status !== 'allowed' ? ` Â· status ${s.status}` : ''}`));
    for (const o of s.other || []) {
      const busy = o.windows.filter((w) => w.used > 0);
      if (busy.length) console.log(c.dim(`          ${o.name}: ${busy.map((w) => `${w.window} ${pct(w.used)}`).join(', ')}`));
    }
  }
  if (b.claude.exhausted) console.log(c.yellow('  ! Claude at its limit: router sends Claude work to Gemini Neon High'));
  if (b.gemini.exhausted) console.log(c.yellow(`  ! Gemini at its limit${b.geminiQuotaHitAt ? ` (quota error ${b.geminiQuotaHitAt})` : ''}: router sends Gemini work to Claude Sonnet`));
}

const BUDGET_KEYS = {
  'claude-5h': 'budgets.claude5h', 'claude-week': 'budgets.claudeWeek',
  'gemini-5h': 'budgets.gemini5h', 'gemini-week': 'budgets.geminiWeek', warn: 'budgets.warnAt',
  'claude-plan': 'subscriptions.claude.monthlyUsd', 'gemini-plan': 'subscriptions.gemini.monthlyUsd',
};

async function cmdBudget(rest, flags, cfg) {
  if (rest[0] === 'set') {
    const key = Object.hasOwn(BUDGET_KEYS, rest[1]) ? BUDGET_KEYS[rest[1]] : null;
    if (!key || rest[2] == null) throw new Error(`Usage: tandem budget set <${Object.keys(BUDGET_KEYS).join('|')}> <value>  (limits as 80% or 0.8)`);
    let v = rest[2];
    if (key.startsWith('budgets.')) {
      const n = v.endsWith('%') ? Number(v.slice(0, -1)) / 100 : Number(v);
      if (!Number.isFinite(n) || n <= 0 || n > 1) throw new Error('Window limits are fractions of the plan window: 0.01â€“1 or 1%â€“100%');
      v = String(n);
    }
    console.log(`${key} = ${setConfigValue(key, v)}`);
    return;
  }
  return cmdUsage(rest, flags, cfg);
}

async function cmdUsage(rest, flags, cfg) {
  if (flags['refresh-claude']) {
    // Claude has no free usage endpoint; the cheapest reading is a one-word Haiku call.
    process.stderr.write(c.dim('refreshing Claude plan usage with a tiny Haiku call (~$0.006 of plan usage)â€¦\n'));
    await callAndLog('claude', { prompt: 'Reply with: ok', model: 'haiku', maxTurns: 1 }, { from: 'tandem', tag: 'usage-probe' }, cfg);
  }
  const usage = await getUsage(cfg, { refresh: true });
  const b = planBudget(usage, cfg, readRecords());
  if (flags.json) return void process.stdout.write(JSON.stringify(b, null, 2) + '\n');
  printBudget(b);
}

function cmdLog(rest, flags) {
  const n = flags.n == null ? 20 : Number(flags.n);
  if (!Number.isInteger(n) || n < 0) throw new Error('--n must be a non-negative integer');
  const recs = n === 0 ? [] : readRecords().slice(-n);
  if (flags.json) return void process.stdout.write(JSON.stringify(recs, null, 2) + '\n');
  for (const r of recs) {
    const color = r.status === 'ok' ? c.green : r.status === 'denied' ? c.yellow : c.red;
    const val = r.to === 'gemini' ? c.green(`savedâ‰ˆ${usd(r.claudeEquivUsd)}`) : `costâ‰ˆ${usd(r.costUsd)}`;
    console.log(`${c.dim(r.ts.replace('T', ' ').slice(0, 19))}  ${r.from} â†’ ${c.bold(r.to)} ${c.cyan(r.model)}  ${color(r.status)}  ${ms(r.durationMs)}  ${tok(r.usage?.total)} tok  ${val}${r.category ? c.dim(`  [${r.category}]`) : ''}`);
  }
}

function cmdConfig(rest) {
  if (rest[0] === 'set') return void console.log(`${rest[1]} = ${JSON.stringify(setConfigValue(rest[1], rest[2]))}`);
  if (rest[0] === 'path') return void console.log(configPath());
  console.log(JSON.stringify({ file: configPath(), ledger: ledgerPath(), user: readUserConfig(), effective: loadConfig() }, null, 2));
}

const HELP = `tandem â€” Claude Code + Gemini (Antigravity) as one team

  tandem ask <gemini|claude> "prompt"   one call  [--model m] [--edit] [--file f] [--continue id] [--json]
  tandem route "task"                   who should do this? (no tokens spent)
  tandem run "task"                     route + call, falls back to the other agent on failure
  tandem review [--agent gemini|claude|both] [--staged] [--base ref]   review git diff
  tandem log [--n 20]                   who talked to whom, tokens, savings
  tandem stats                          totals, savings, plan usage
  tandem usage [--refresh-claude]       5h + weekly plan windows for Claude and Gemini
  tandem budget set <key> <value>       window limits: claude-5h | claude-week | gemini-5h | gemini-week (e.g. 80%)
                                        warn | claude-plan | gemini-plan (USD/month, for value stats)
  tandem dashboard [--port 4777]        local web UI
  tandem bench [--models a,b] [--tasks x,y] [--repeat n]   benchmark models on graded tasks
  tandem init [dir] [--mcp]             add AGENTS.md, CLAUDE.md, skills, rules to a project
  tandem init --global                  once per machine: /gemini skill, agy rule, MCP in both agents
  tandem doctor                         check installs, logins, permissions
  tandem mcp [--expose gemini|claude|both]   MCP server so agents call each other as tools
  tandem config [set <key> <value>|path]

Gemini model aliases: flash, flash-low, hydrogen, orchestrator, neon, neon-high, argon (or any agy slug).
Claude model aliases: haiku, sonnet, opus.`;

export async function main(argv) {
  const { _: [cmd, ...rest], flags } = parseArgs(argv);
  if (!cmd || flags.help || cmd === 'help') return void console.log(HELP);
  const cfg = loadConfig();
  switch (cmd) {
    case 'ask': return cmdAsk(rest, flags, cfg);
    case 'route': return cmdRoute(rest, flags, cfg);
    case 'run': return cmdRun(rest, flags, cfg);
    case 'review': return cmdReview(rest, flags, cfg);
    case 'stats': return cmdStats(rest, flags, cfg);
    case 'budget': return cmdBudget(rest, flags, cfg);
    case 'usage': return cmdUsage(rest, flags, cfg);
    case 'log': return cmdLog(rest, flags, cfg);
    case 'config': return cmdConfig(rest, flags, cfg);
    case 'init': {
      const mod = await import('./init.js');
      return flags.global ? mod.initGlobal(flags) : mod.init(rest[0] || '.', flags);
    }
    case 'doctor': return (await import('./doctor.js')).doctor(cfg, flags);
    case 'mcp': return (await import('./mcp.js')).serve(flags.expose || 'gemini', cfg);
    case 'hook': return (await import('./hooks.js')).runHook(rest[0], cfg);
    case 'dashboard': return (await import('./dashboard/server.js')).startDashboard(Number(flags.port || 4777), cfg, flags);
    case 'bench': return (await import('./bench/run.js')).bench(flags, cfg);
    default: throw new Error(`Unknown command "${cmd}". Run: tandem help`);
  }
}
