import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadConfig, setConfigValue, configPath, readUserConfig, saveUserConfig, GEMINI_ALIASES, CLAUDE_ALIASES, resolveGeminiModel, resolveClaudeModel } from './config.js';
import { ask, findAgy } from './agents.js';
import { run as spawnRun } from './proc.js';
import { makeRecord, appendRecord, readRecords, summarize, ledgerPath, planBudget } from './ledger.js';
import { getUsage, storeSnapshot } from './usage.js';
import { route, RULES, parsePin } from './router.js';
import { usd, tok, ms, pct, c, bar, table } from './format.js';

const BOOL = new Set(['edit', 'json', 'force', 'mcp', 'open', 'no-fallback', 'staged', 'help', 'quiet', 'dry-run', 'live', 'global', 'refresh-claude', 'clear']);

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

/** "a;b" → ["a","b"] (semicolon: paths and rules can contain commas). */
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
  if (res.denied.length) process.stderr.write(c.yellow(`! denied: ${res.denied.join(', ')} — use --edit for edits; shell commands need agent allow-rules\n`));
  if (!res.ok) process.stderr.write(c.red(`✗ ${res.agent} ${res.status}: ${res.error || ''}\n`));
  const saved = res.agent === 'gemini' ? ` · saved≈${usd(rec.claudeEquivUsd)} vs ${loadConfig().savingsBaseline}` : ` · cost≈${usd(rec.costUsd)}`;
  process.stderr.write(c.dim(`[${res.agent} ${res.model} · ${res.status} · ${ms(res.durationMs)} · ${tok(res.usage.total)} tok${saved} · session ${res.sessionId}]\n`));
}

function exitFor(res) { process.exitCode = res.ok ? 0 : res.status === 'denied' ? 3 : 1; }

/** Who invoked this CLI command: explicit --from, TANDEM_CALLER, or host agent env. */
export function inferCaller(flags = {}, env = process.env) {
  if (flags.from) return flags.from;
  if (env.TANDEM_CALLER) return env.TANDEM_CALLER;
  if (env.CLAUDECODE === '1' || Boolean(env.CLAUDE_CODE_ENTRYPOINT?.trim())) return 'claude';
  return 'user';
}

const inferLead = (flags, from) => flags.lead || (from === 'claude' || from === 'gemini' ? from : null);

async function cmdAsk(rest, flags, cfg) {
  const [agent, ...words] = rest;
  if (!['gemini', 'claude'].includes(agent)) throw new Error('Usage: tandem ask <gemini|claude> "prompt" [--model m] [--edit] [--file f]');
  const prompt = await promptFrom(words, flags);
  if (!prompt) throw new Error('Empty prompt');
  const from = inferCaller(flags);
  const { res, rec } = await callAndLog(agent, {
    prompt, model: flags.model, edit: !!flags.edit, effort: flags.effort,
    conversation: flags.continue, resume: flags.continue, cwd: flags.cwd,
    timeoutMs: parseDuration(flags.timeout), maxTurns: flags['max-turns'] ? Number(flags['max-turns']) : undefined,
    addDirs: list(flags['add-dir']), allow: list(flags.allow),
  }, { from, tag: flags.tag, thread: flags.thread || null, lead: inferLead(flags, from) }, cfg);
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
  const from = inferCaller(flags);
  const lead = inferLead(flags, from);
  const pick = route(prompt, await currentBudget(cfg), { pins: cfg.routing?.pins, lead });
  const model = flags.model || pick.model;
  process.stderr.write(c.dim(`→ ${pick.agent}/${model} (${pick.category}): ${pick.reason}\n`));
  for (const n of pick.notes) process.stderr.write(c.yellow(`! ${n}\n`));
  const meta = { from, category: pick.category, tag: flags.tag, thread: flags.thread || null, lead };
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
  const from = inferCaller(flags);
  const lead = inferLead(flags, from);
  const runs = await Promise.all(agents.map((a) => callAndLog(a, {
    prompt, model: a === 'gemini' ? (flags['gemini-model'] || 'neon') : (flags['claude-model'] || 'sonnet'), cwd: flags.cwd,
  }, { from, category: 'review', tag: flags.tag, thread: flags.thread || null, lead }, cfg)));
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

async function cmdStats(rest, flags, cfg) {
  (await import('./hooks.js')).sweep(cfg); // pick up token counts agents wrote after their Stop hook
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
  console.log(`  this week: ${c.green(usd(sv.offloadedWeekUsd))} offloaded · Claude spent ${usd(sv.claudeWeekUsd)} · Gemini share ${pct(sv.offloadShareWeek)}`);
  console.log(`  all time:  ${c.green(usd(sv.offloadedAllUsd))} offloaded` + (sv.geminiMonthlyUsd ? ` · Gemini plan ${usd(sv.geminiMonthlyUsd)}/mo` : ''));
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
      console.log(`  ${name.padEnd(7)}${label}  ${bar(w.used / lim, 20, false)}  ${pct(w.used).padStart(4)} of plan · limit ${pct(lim)}  ${resetsIn(w.resetsAt)}`);
    }
    console.log(c.dim(`          from ${s.source}, ${age(s.ageMs)}${s.status && s.status !== 'allowed' ? ` · status ${s.status}` : ''}`));
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
      if (!Number.isFinite(n) || n <= 0 || n > 1) throw new Error('Window limits are fractions of the plan window: 0.01–1 or 1%–100%');
      v = String(n);
    }
    console.log(`${key} = ${setConfigValue(key, v)}`);
    return;
  }
  return cmdUsage(rest, flags, cfg);
}

async function cmdUsage(rest, flags, cfg) {
  (await import('./hooks.js')).sweep(cfg);
  if (flags['refresh-claude']) {
    // Claude has no free usage endpoint; the cheapest reading is a one-word Haiku call.
    process.stderr.write(c.dim('refreshing Claude plan usage with a tiny Haiku call (~$0.006 of plan usage)…\n'));
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
    const val = r.to === 'gemini' ? c.green(`saved≈${usd(r.claudeEquivUsd)}`) : `cost≈${usd(r.costUsd)}`;
    console.log(`${c.dim(r.ts.replace('T', ' ').slice(0, 19))}  ${r.from} → ${c.bold(r.to)} ${c.cyan(r.model)}  ${color(r.status)}  ${ms(r.durationMs)}  ${tok(r.usage?.total)} tok  ${val}${r.category ? c.dim(`  [${r.category}]`) : ''}`);
  }
}

function cmdConfig(rest) {
  if (rest[0] === 'set') return void console.log(`${rest[1]} = ${JSON.stringify(setConfigValue(rest[1], rest[2]))}`);
  if (rest[0] === 'path') return void console.log(configPath());
  console.log(JSON.stringify({ file: configPath(), ledger: ledgerPath(), user: readUserConfig(), effective: loadConfig() }, null, 2));
}

const PIN_CATEGORIES = new Set([...RULES.map((r) => r.category), 'trivial', 'general']);

function validateModel(agent, model) {
  if (agent === 'claude') {
    if (!Object.hasOwn(CLAUDE_ALIASES, model)) {
      throw new Error(`Unknown claude model "${model}". Aliases: ${Object.keys(CLAUDE_ALIASES).join(', ')}`);
    }
    return;
  }
  if (!Object.hasOwn(GEMINI_ALIASES, model) && !/^[a-z0-9.-]+$/.test(model)) {
    throw new Error(`Unknown gemini model "${model}". Aliases: ${Object.keys(GEMINI_ALIASES).join(', ')} (or any slug matching /^[a-z0-9.-]+$/)`);
  }
}

function savePins(mutate) {
  const user = readUserConfig();
  const pins = { ...(user.routing?.pins || {}) };
  mutate(pins);
  user.routing = { ...(user.routing || {}), pins };
  saveUserConfig(user);
  return pins;
}

function cmdPrefer(rest, flags, cfg) {
  if (!rest.length) {
    if (flags.json) return void process.stdout.write(JSON.stringify(cfg.defaults, null, 2) + '\n');
    console.log(`claude  ${c.cyan(cfg.defaults.claudeModel)}  ${c.dim(`→ ${resolveClaudeModel(cfg.defaults.claudeModel)}`)}`);
    console.log(`gemini  ${c.cyan(cfg.defaults.geminiModel)}  ${c.dim(`→ ${resolveGeminiModel(cfg.defaults.geminiModel)}`)}`);
    return;
  }
  const [agent, model] = rest;
  if ((agent !== 'claude' && agent !== 'gemini') || !model) throw new Error('Usage: tandem prefer [claude|gemini <model>]');
  validateModel(agent, model);
  const key = agent === 'claude' ? 'defaults.claudeModel' : 'defaults.geminiModel';
  setConfigValue(key, model);
  const resolved = agent === 'claude' ? resolveClaudeModel(model) : resolveGeminiModel(model);
  console.log(`${key} = ${model}${resolved && resolved !== model ? c.dim(` (${resolved})`) : ''}`);
}

function cmdPin(rest, flags, cfg) {
  const pins = cfg.routing?.pins || {};
  if (!rest.length && !flags.clear) {
    if (flags.json) return void process.stdout.write(JSON.stringify(pins, null, 2) + '\n');
    const entries = Object.entries(pins);
    if (!entries.length) return void console.log(c.dim('No pins set. Use: tandem pin <category> <agent:model>'));
    console.log(table(entries.map(([cat, val]) => [cat, val]), ['category', 'pin']));
    return;
  }
  const [category, spec] = rest;
  if (!category || !PIN_CATEGORIES.has(category)) {
    throw new Error(`Unknown category "${category || ''}". Categories: ${[...PIN_CATEGORIES].join(', ')}`);
  }
  if (flags.clear) {
    savePins((p) => { delete p[category]; });
    console.log(`Cleared pin for ${category}`);
    return;
  }
  if (!spec) throw new Error('Usage: tandem pin [<category> <agent:model> | <category> --clear]');
  const parsed = parsePin(spec);
  validateModel(parsed.agent, parsed.model);
  const value = `${parsed.agent}:${parsed.model}`;
  savePins((p) => { p[category] = value; });
  console.log(`routing.pins.${category} = ${value}`);
}

async function cmdModels(rest, flags, cfg) {
  const defC = cfg.defaults?.claudeModel;
  const defG = cfg.defaults?.geminiModel;
  const rows = [
    ...Object.entries(CLAUDE_ALIASES).map(([a, s]) => ['claude', `${c.cyan(a)}${a === defC ? ` ${c.yellow('★')}` : ''}`, s]),
    ...Object.entries(GEMINI_ALIASES).map(([a, s]) => ['gemini', `${c.cyan(a)}${a === defG ? ` ${c.yellow('★')}` : ''}`, s]),
  ];
  if (defG && !Object.hasOwn(GEMINI_ALIASES, defG)) {
    rows.push(['gemini', `${c.cyan(defG)} ${c.yellow('★')}`, defG]);
  }
  const pins = cfg.routing?.pins || {};
  let live = null;
  if (flags.live) {
    const bin = findAgy(cfg);
    if (!bin) live = 'agy not found';
    else {
      const r = await spawnRun(bin, ['models'], { timeoutMs: 15_000 });
      live = (r.stdout || r.stderr || `agy exited ${r.code}`).trim();
    }
  }
  if (flags.json) {
    process.stdout.write(JSON.stringify({ defaults: cfg.defaults, aliases: { claude: CLAUDE_ALIASES, gemini: GEMINI_ALIASES }, pins, ...(live != null ? { live } : {}) }, null, 2) + '\n');
    return;
  }
  console.log(table(rows, ['agent', 'alias', 'model']));
  const pinRows = Object.entries(pins);
  if (pinRows.length) {
    console.log('\n' + c.bold('Pins'));
    console.log(table(pinRows, ['category', 'pin']));
  } else {
    console.log('\n' + c.dim('Pins: none (set with: tandem pin <category> <agent:model>)'));
  }
  if (live != null) {
    console.log('\n' + c.bold('Live (agy models)'));
    console.log(live);
  }
}

async function cmdShow(rest, flags) {
  const records = readRecords();
  const target = rest[0] || 'last';
  const maxChars = flags.max == null ? 4000 : Number(flags.max);
  if (!Number.isFinite(maxChars) || maxChars < 0) throw new Error('--max must be a non-negative number');

  let selected;
  let threadId = null;
  if (target.startsWith('thread:')) {
    threadId = target.slice('thread:'.length);
    if (!threadId) throw new Error('Usage: tandem show thread:<id>');
    selected = records.filter((r) => r.thread === threadId).sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
    if (!selected.length) throw new Error(`No records found for thread "${threadId}"`);
  } else if (target === 'last') {
    if (!records.length) throw new Error('Ledger is empty.');
    selected = [records.at(-1)];
  } else {
    const exact = records.find((r) => r.id === target);
    if (exact) selected = [exact];
    else {
      const hits = records.filter((r) => r.id?.startsWith(target));
      if (hits.length === 1) selected = hits;
      else if (hits.length > 1) throw new Error(`Ambiguous ledger id prefix "${target}" (${hits.length} matches)`);
      else throw new Error(`No ledger record found for "${target}"`);
    }
  }

  const { readTranscript } = await import('./transcripts.js');
  const items = selected.map((rec) => ({ rec, transcript: readTranscript(rec, { maxChars }) }));
  if (flags.json) {
    const payload = threadId
      ? { thread: threadId, records: items.map(({ rec, transcript }) => ({ record: rec, transcript })) }
      : { record: items[0].rec, transcript: items[0].transcript };
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    return;
  }

  for (let i = 0; i < items.length; i++) {
    const { rec, transcript } = items[i];
    if (i > 0) console.log('\n' + c.dim('─'.repeat(60)) + '\n');
    const color = rec.status === 'ok' ? c.green : rec.status === 'denied' ? c.yellow : c.red;
    console.log(`${c.dim(rec.ts.replace('T', ' ').slice(0, 19))}  ${rec.from} → ${c.bold(rec.to)} ${c.cyan(rec.model || rec.to)}  ${color(rec.status)}  ${tok(rec.usage?.total)} tok${rec.thread ? c.dim(`  thread:${rec.thread}`) : ''}`);
    console.log(c.dim(`resume: ${transcript.resume || '(none)'}`));
    if (!transcript.found) {
      console.log(c.yellow(`Transcript not found${transcript.path ? ` (${transcript.path})` : ''}.`));
      continue;
    }
    if (!transcript.messages.length) {
      console.log(c.dim('(transcript has no displayable messages)'));
      continue;
    }
    for (const m of transcript.messages) {
      if (m.role === 'user') {
        console.log(`\n${c.cyan('› user')}`);
        console.log(m.text);
      } else if (m.role === 'assistant') {
        console.log(`\n${c.green('‹ assistant')}${m.model ? ` ${c.dim(m.model)}` : ''}`);
        console.log(m.text);
      } else {
        console.log(`\n${c.dim('· tool')}`);
        console.log(c.dim(m.text));
      }
    }
  }
}

const HELP = `tandem — Claude Code + Gemini (Antigravity) as one team

  tandem ask <gemini|claude> "prompt"   one call  [--model m] [--edit] [--file f] [--continue id] [--thread id] [--lead a] [--json]
  tandem route "task"                   who should do this? (no tokens spent) [--lead a]
  tandem run "task"                     route + call, falls back to the other agent on failure [--thread id] [--lead a]
  tandem review [--agent gemini|claude|both] [--staged] [--base ref] [--thread id]   review git diff
  tandem show [last|<id>|thread:<id>]   render an exchange from its native transcript [--max 4000] [--json]
  tandem prefer [claude|gemini <model>] view or set default models
  tandem pin [<cat> <agent:model>|--clear]   view, set or clear per-category routing pins
  tandem models [--live]                list aliases → slugs, defaults (★) and pins
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

Gemini model aliases: flash, flash-low, hydrogen, orchestrator (Neon plans, Hydrogen executes), neon, neon-high, argon (or any agy slug).
Claude model aliases: haiku, sonnet, opus.`;

export async function main(argv) {
  const { _: [cmd, ...rest], flags } = parseArgs(argv);
  if (!cmd || flags.help || cmd === 'help') return void console.log(HELP);
  // Hooks load config themselves: a broken config file must never fail an agent's Stop hook.
  if (cmd === 'hook') return (await import('./hooks.js')).runHook(rest[0]);
  const cfg = loadConfig();
  switch (cmd) {
    case 'ask': return cmdAsk(rest, flags, cfg);
    case 'route': return cmdRoute(rest, flags, cfg);
    case 'run': return cmdRun(rest, flags, cfg);
    case 'review': return cmdReview(rest, flags, cfg);
    case 'prefer': return cmdPrefer(rest, flags, cfg);
    case 'pin': return cmdPin(rest, flags, cfg);
    case 'models': return cmdModels(rest, flags, cfg);
    case 'show': return cmdShow(rest, flags, cfg);
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
    case 'dashboard': return (await import('./dashboard/server.js')).startDashboard(Number(flags.port || 4777), cfg, flags);
    case 'bench': return (await import('./bench/run.js')).bench(flags, cfg);
    default: throw new Error(`Unknown command "${cmd}". Run: tandem help`);
  }
}
