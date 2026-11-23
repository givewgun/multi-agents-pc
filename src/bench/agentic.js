// Agentic team bench: a lead agent works in a real temp project, may delegate to its partner
// through tandem's MCP tools, and is graded by hidden tests it never saw.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENTIC_TASKS } from './agentic-tasks.js';
import { callAndLog } from '../cli.js';
import { readRecords } from '../ledger.js';
import { tandemHome, loadConfig, soloBlock } from '../config.js';
import { usd, ms, pct, c, table } from '../format.js';

const TEST_ALLOW_CLAUDE = ['Bash(node --test:*)', 'Bash(npm test:*)'];
const TEST_ALLOW_GEMINI = ['command(node --test)', 'command(npm test)'];

const FOOTER = '\n\nWork only inside the current directory. Run `node --test` to check your work. When done, reply with a two-line summary of what you changed.';

export const HINTS = {
  claude: '\n\nUse tandem freely. Team: you have a teammate, Gemini, via the `ask_gemini` tool (always pass `cwd` = the current directory). Gemini is on a flat subscription (cheap) and good at reading many files, summarizing, writing tests and first-pass review; you are expensive and best at judgment and precise edits. Delegate whatever saves you effort. You own the final result.',
  gemini: '\n\nUse tandem freely. Team: you have a teammate, Claude, via the `ask_claude` tool (always pass `cwd` = the current directory). Claude costs real money per call; use it only where its judgment clearly matters (a hard bug you are unsure about, a final review). You own the final result.',
};

export const SETUPS = {
  'claude-solo': { lead: 'claude', model: 'sonnet', team: false, desc: 'Sonnet alone (tandem MCP disabled)' },
  'claude-lead': { lead: 'claude', model: 'sonnet', team: true, desc: 'Sonnet leads, may call Gemini' },
  'gemini-solo': { lead: 'gemini', model: 'neon', team: false, desc: 'Neon alone' },
  'gemini-lead': { lead: 'gemini', model: 'neon', team: true, desc: 'Neon leads, may call Claude' },
};

const TANDEM_BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'tandem.js');

/** MCP config holding only tandem (exposing ask_gemini), so headless Claude doesn't load the user's other servers. */
export function tandemMcpConfig(dir) {
  const file = path.join(dir, 'bench-mcp.json');
  writeFileSync(file, JSON.stringify({ mcpServers: { tandem: { command: process.execPath, args: [TANDEM_BIN, 'mcp', '--expose', 'gemini'] } } }));
  return file;
}

export function leadOpts(setup, prompt, cwd, mcpConfig) {
  const s = SETUPS[setup];
  const base = { prompt: prompt + (s.team ? HINTS[s.lead] : '') + FOOTER, model: s.model, edit: true, cwd, timeoutMs: 20 * 60_000 };
  if (s.lead === 'claude') {
    return { ...base, maxTurns: 40, allow: s.team ? [...TEST_ALLOW_CLAUDE, 'mcp__tandem__ask_gemini'] : TEST_ALLOW_CLAUDE,
      disallow: s.team ? [] : ['mcp__tandem'], strictMcp: true, mcpConfig: s.team ? mcpConfig : undefined };
  }
  return { ...base, allow: s.team ? [...TEST_ALLOW_GEMINI, 'mcp(tandem_tandem/ask_claude)'] : TEST_ALLOW_GEMINI };
}

function writeTree(root, files) {
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(root, ...rel.split('/'));
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
}

/** Parse `node --test` TAP summary lines. */
export function tapCounts(out) {
  const n = (k) => Number((new RegExp(`^# ${k} (\\d+)`, 'm').exec(out) || [])[1] || 0);
  const pass = n('pass'); const fail = n('fail') + n('cancelled');
  return { pass, fail, total: pass + fail };
}

/** Copy hidden tests in after the agent is done, run them, then remove them. */
export function gradeHidden(dir, task) {
  writeTree(dir, task.hidden);
  const files = Object.keys(task.hidden).map((f) => path.join(dir, ...f.split('/')));
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // else a nested run reports to a parent test runner instead of printing TAP
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...files], { cwd: dir, env, encoding: 'utf8', timeout: 60_000, windowsHide: true });
  const k = tapCounts(r.stdout || '');
  return { passed: k.pass, total: k.total, score: k.total ? k.pass / k.total : 0, pass: r.status === 0 && k.total > 0 && k.fail === 0 };
}

/** Partner calls the lead made through tandem MCP: ledger rows for this workdir that the bench didn't make. */
export function delegations(records, project, since) {
  return records.filter((r) => r.project === project && r.ts >= since && r.from !== 'bench');
}

export async function agenticBench(flags, cfg) {
  const tasks = flags.tasks ? AGENTIC_TASKS.filter((t) => String(flags.tasks).split(',').includes(t.id)) : AGENTIC_TASKS;
  if (!tasks.length) throw new Error(`No matching tasks. Available: ${AGENTIC_TASKS.map((t) => t.id).join(', ')}`);
  const names = flags.setups ? String(flags.setups).split(',') : Object.keys(SETUPS);
  const bad = names.find((n) => !SETUPS[n]);
  if (bad) throw new Error(`Unknown setup "${bad}". Available: ${Object.keys(SETUPS).join(', ')}`);
  if (names.some((n) => SETUPS[n].team) && soloBlock(loadConfig())) throw new Error('solo mode is on: team setups need delegation. Run `tandem solo off`, or pick solo setups with --setups.');
  const root = path.resolve(flags.workdir || path.join(os.tmpdir(), 'tandem-bench'));
  mkdirSync(root, { recursive: true });
  const jobs = [];
  for (const t of tasks) for (const s of names) jobs.push({ t, s });
  const benchDir = path.join(tandemHome(), 'bench');
  mkdirSync(benchDir, { recursive: true });
  const mcpConfig = tandemMcpConfig(benchDir);
  console.log(c.dim(`agentic bench: ${tasks.length} tasks × ${names.length} setups = ${jobs.length} runs in ${root}`));

  const results = [];
  // Sequential on purpose: agentic runs are heavy and nested calls share both plans' quotas.
  for (const { t, s } of jobs) {
    const project = `tb-${t.id}-${s}-${randomBytes(3).toString('hex')}`;
    const dir = path.join(root, project);
    writeTree(dir, t.files);
    const since = new Date().toISOString();
    const setup = SETUPS[s];
    const { res, rec } = await callAndLog(setup.lead, leadOpts(s, t.prompt, dir, mcpConfig), { from: 'bench', category: t.category, tag: `bench-agentic:${s}`, cwd: dir }, cfg);
    const g = gradeHidden(dir, t);
    const dels = delegations(readRecords(), project, since);
    const partnerUsd = dels.reduce((a, r) => a + (r.costUsd || 0), 0);
    const row = {
      task: t.id, setup: s, status: res.status, score: g.score, pass: g.pass, hidden: `${g.passed}/${g.total}`,
      ms: res.durationMs, turns: res.turns, claudeUsd: (rec.costUsd || 0) + partnerUsd,
      leadUsd: rec.costUsd || 0, delegations: dels.length, partnerUsd, denied: res.denied, workdir: dir,
    };
    results.push(row);
    console.log(`  ${row.pass ? c.green('pass') : row.score > 0 ? c.yellow(pct(row.score).padStart(4)) : c.red('fail')} ${t.id.padEnd(22)} ${s.padEnd(12)} ${ms(row.ms).padStart(6)} ${usd(row.claudeUsd).padStart(8)}  calls→partner ${dels.length}${res.ok ? '' : c.red(`  ${res.status}`)}`);
    if (!flags.keep) rmSync(dir, { recursive: true, force: true });
  }

  const report = analyzeAgentic(results, names, tasks);
  printAgentic(report);
  const file = path.join(benchDir, `agentic-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), setups: names, tasks: tasks.map((t) => t.id), results, report }, null, 2));
  if (flags.out) writeFileSync(flags.out, agenticMarkdown(report));
  console.log(c.dim(`\nraw results: ${file}${flags.out ? `\nmarkdown: ${flags.out}` : ''}`));
}

export function analyzeAgentic(results, names, tasks) {
  const avg = (rs, f) => rs.reduce((a, r) => a + f(r), 0) / (rs.length || 1);
  const perSetup = names.map((s) => {
    const rs = results.filter((r) => r.setup === s);
    return { setup: s, desc: SETUPS[s].desc, runs: rs.length, avgScore: avg(rs, (r) => r.score), passRate: avg(rs, (r) => (r.pass ? 1 : 0)),
      avgMs: avg(rs, (r) => r.ms), claudeUsd: rs.reduce((a, r) => a + r.claudeUsd, 0), delegations: rs.reduce((a, r) => a + r.delegations, 0) };
  });
  const perTask = tasks.map((t) => ({ task: t.id, cells: Object.fromEntries(names.map((s) => {
    const r = results.find((x) => x.task === t.id && x.setup === s);
    return [s, r ? `${r.hidden}${r.delegations ? ` (${r.delegations}↗)` : ''}` : '-'];
  })) }));
  return { perSetup, perTask, names };
}

function printAgentic({ perSetup, perTask, names }) {
  console.log('\n' + c.bold('Per setup'));
  console.log(table(perSetup.map((p) => [p.setup, pct(p.avgScore), pct(p.passRate), ms(p.avgMs), usd(p.claudeUsd), String(p.delegations), p.desc]),
    ['setup', 'hidden score', 'pass', 'avg time', 'claude $', 'delegations', 'how']));
  console.log('\n' + c.bold('Per task (hidden tests passed, ↗ = partner calls)'));
  console.log(table(perTask.map((t) => [t.task, ...names.map((s) => t.cells[s])]), ['task', ...names]));
}

export function agenticMarkdown({ perSetup, perTask, names }) {
  const L = ['## Agentic: per setup', '', '| setup | how | hidden score | pass | avg time | Claude $ (total) | partner calls |', '|---|---|---|---|---|---|---|'];
  for (const p of perSetup) L.push(`| ${p.setup} | ${p.desc} | ${pct(p.avgScore)} | ${pct(p.passRate)} | ${ms(p.avgMs)} | ${usd(p.claudeUsd)} | ${p.delegations} |`);
  L.push('', '## Agentic: per task (hidden tests passed, ↗ = partner calls)', '', `| task | ${names.join(' | ')} |`, `|---|${names.map(() => '---').join('|')}|`);
  for (const t of perTask) L.push(`| ${t.task} | ${names.map((s) => t.cells[s]).join(' | ')} |`);
  return L.join('\n') + '\n';
}
