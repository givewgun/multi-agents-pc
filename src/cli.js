import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadConfig, setConfigValue, configPath, readUserConfig } from './config.js';
import { ask } from './agents.js';
import { makeRecord, appendRecord, readRecords, summarize, ledgerPath } from './ledger.js';
import { route } from './router.js';
import { usd, tok, ms, pct, c, bar, table } from './format.js';

const BOOL = new Set(['edit', 'json', 'force', 'mcp', 'open', 'no-fallback', 'staged', 'help', 'quiet', 'dry-run', 'live', 'global']);

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
  const rec = appendRecord(makeRecord(res, { promptChars: opts.prompt.length, cwd: opts.cwd, ...meta }, cfg));
  return { res, rec };
}

function printResult(res, rec, flags) {
  if (flags.json) { process.stdout.write(JSON.stringify({ ...res, stderr: undefined, record: rec }, null, 2) + '\n'); return; }
  if (res.text) process.stdout.write(res.text.trimEnd() + '\n');
  if (res.denied.length) process.stderr.write(c.yellow(`! denied: ${res.denied.join(', ')} — use --edit for edits; shell commands need agent allow-rules\n`));
  if (!res.ok) process.stderr.write(c.red(`✗ ${res.agent} ${res.status}: ${res.error || ''}\n`));
  const saved = res.agent === 'gemini' ? ` · saved≈${usd(rec.claudeEquivUsd)} vs ${loadConfig().savingsBaseline}` : ` · cost≈${usd(rec.costUsd)}`;
  process.stderr.write(c.dim(`[${res.agent} ${res.model} · ${res.status} · ${ms(res.durationMs)} · ${tok(res.usage.total)} tok${saved} · session ${res.sessionId}]\n`));
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
  }, { from: flags.from || process.env.TANDEM_CALLER || 'user', tag: flags.tag }, cfg);
  printResult(res, rec, flags);
  exitFor(res);
}

async function cmdRoute(rest, flags, cfg) {
  const task = await promptFrom(rest, flags);
  const pick = route(task, summarize(readRecords(), cfg).budget);
  if (flags.json) return void process.stdout.write(JSON.stringify(pick, null, 2) + '\n');
  console.log(`${c.bold(pick.agent)} ${c.cyan(pick.model)}  ${c.dim(`[${pick.category}, confidence ${pct(pick.confidence)}]`)}`);
  console.log(pick.reason);
  for (const n of pick.notes) console.log(c.yellow(`! ${n}`));
  if (pick.alternatives.length) console.log(c.dim(`alternatives: ${pick.alternatives.map((a) => `${a.agent}/${a.model} (${a.category})`).join(', ')}`));
}

async function cmdRun(rest, flags, cfg) {
  const prompt = await promptFrom(rest, flags);
  if (!prompt) throw new Error('Usage: tandem run "task" [--edit] [--no-fallback]');
  const pick = route(prompt, summarize(readRecords(), cfg).budget);
  const model = flags.model || pick.model;
  process.stderr.write(c.dim(`→ ${pick.agent}/${model} (${pick.category}): ${pick.reason}\n`));
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
Format: one bullet per finding, "path:line — problem — fix". If nothing is wrong, reply exactly "LGTM".
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
      if (agents.length > 1) console.log(c.bold(`\n── ${res.agent} (${res.model}) ──`));
      printResult(res, rec, flags);
    }
  }
  process.exitCode = runs.every((r) => r.res.ok) ? 0 : 1;
}

function cmdStats(rest, flags, cfg) {
  const s = summarize(readRecords(), cfg);
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
  console.log(`  this week: ${c.green(usd(sv.offloadedWeekUsd))} offloaded · Claude spent ${usd(sv.claudeWeekUsd)} · Gemini share ${pct(sv.offloadShareWeek)}`);
  console.log(`  all time:  ${c.green(usd(sv.offloadedAllUsd))} offloaded` + (sv.geminiMonthlyUsd ? ` · Gemini plan ${usd(sv.geminiMonthlyUsd)}/mo` : ''));
  printBudget(s.budget);
}

function printBudget(b) {
  console.log('\n' + c.bold('Budget'));
  console.log(`  Claude 7d   ${bar(b.claudeWeek.ratio)}  ${usd(b.claudeWeek.used)} / ${usd(b.claudeWeek.cap)}`);
  console.log(`  Gemini 5h   ${bar(b.gemini5h.ratio)}  ${b.gemini5h.used} / ${b.gemini5h.cap ?? '—'} calls`);
  console.log(`  Gemini 7d   ${bar(b.geminiWeek.ratio)}  ${b.geminiWeek.used} / ${b.geminiWeek.cap ?? '—'} calls`);
  if (b.geminiLikelyLimited) console.log(c.yellow(`  ! Gemini quota error at ${b.geminiQuotaHitAt}; router prefers Claude for 5h`));
}

function cmdBudget(rest, flags, cfg) {
  if (rest[0] === 'set') {
    const map = { claude: 'budgets.claudeWeeklyUsd', 'gemini-5h': 'budgets.gemini5hCalls', 'gemini-week': 'budgets.geminiWeeklyCalls', warn: 'budgets.warnAt', 'claude-plan': 'subscriptions.claude.monthlyUsd', 'gemini-plan': 'subscriptions.gemini.monthlyUsd' };
    const key = Object.hasOwn(map, rest[1]) ? map[rest[1]] : null;
    if (!key || rest[2] == null) throw new Error(`Usage: tandem budget set <${Object.keys(map).join('|')}> <value>`);
    console.log(`${key} = ${setConfigValue(key, rest[2])}`);
    return;
  }
  printBudget(summarize(readRecords(), cfg).budget);
}

function cmdLog(rest, flags) {
  const n = flags.n == null ? 20 : Number(flags.n);
  if (!Number.isInteger(n) || n < 0) throw new Error('--n must be a non-negative integer');
  const recs = n === 0 ? [] : readRecords().slice(-n);
  if (flags.json) return void process.stdout.write(JSON.stringify(recs, null, 2) + '\n');
  for (const r of recs) {
    const color = r.status === 'ok' ? c.green : r.status === 'denied' ? c.yellow : c.red;
    const val = r.to === 'gemini' ? c.green(`saved≈${usd(r.claudeEquivUsd)}`) : `cost≈${usd(r.costUsd)}`;
    console.log(`${c.dim(r.ts.replace('T', ' ').slice(0, 19))}  ${r.from} → ${c.bold(r.to)} ${c.cyan(r.model)}  ${color(r.status)}  ${ms(r.durationMs)}  ${tok(r.usage?.total)} tok  ${val}${r.category ? c.dim(`  [${r.category}]`) : ''}`);
  }
}

function cmdConfig(rest) {
  if (rest[0] === 'set') return void console.log(`${rest[1]} = ${JSON.stringify(setConfigValue(rest[1], rest[2]))}`);
  if (rest[0] === 'path') return void console.log(configPath());
  console.log(JSON.stringify({ file: configPath(), ledger: ledgerPath(), user: readUserConfig(), effective: loadConfig() }, null, 2));
}

const HELP = `tandem — Claude Code + Gemini (Antigravity) as one team

  tandem ask <gemini|claude> "prompt"   one call  [--model m] [--edit] [--file f] [--continue id] [--json]
  tandem route "task"                   who should do this? (no tokens spent)
  tandem run "task"                     route + call, falls back to the other agent on failure
  tandem review [--agent gemini|claude|both] [--staged] [--base ref]   review git diff
  tandem log [--n 20]                   who talked to whom, tokens, savings
  tandem stats                          totals, savings, budget
  tandem budget [set <key> <value>]     claude | gemini-5h | gemini-week | warn | claude-plan | gemini-plan
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
    case 'log': return cmdLog(rest, flags, cfg);
    case 'config': return cmdConfig(rest, flags, cfg);
    case 'init': {
      const mod = await import('./init.js');
      return flags.global ? mod.initGlobal(flags) : mod.init(rest[0] || '.', flags);
    }
    case 'doctor': return (await import('./doctor.js')).doctor(cfg, flags);
    case 'mcp': return (await import('./mcp.js')).serve(flags.expose || 'gemini', cfg);
    case 'dashboard': return (await import('./dashboard/server.js')).startDashboard(Number(flags.port || 4777), cfg, flags);
    case 'bench': return (await import('./bench/run.js')).bench(flags, cfg);
    default: throw new Error(`Unknown command "${cmd}". Run: tandem help`);
  }
}
