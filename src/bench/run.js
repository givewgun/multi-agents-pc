import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { TASKS } from './tasks.js';
import { callAndLog } from '../cli.js';
import { RULES } from '../router.js';
import { tandemHome } from '../config.js';
import { usd, tok, ms, pct, c, table } from '../format.js';

const DEFAULT_MODELS = ['gemini:flash-low', 'gemini:flash', 'gemini:hydrogen', 'gemini:orchestrator', 'gemini:neon', 'claude:haiku', 'claude:sonnet'];

function parseModel(s) {
  const [agent, model] = s.includes(':') ? s.split(':') : [/^(haiku|sonnet|opus|claude)/.test(s) ? 'claude' : 'gemini', s];
  return { agent, model, key: `${agent}:${model}` };
}

/** Run fn over items with at most n in flight. */
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

export async function bench(flags, cfg) {
  const models = (flags.models ? String(flags.models).split(',') : DEFAULT_MODELS).map(parseModel);
  const tasks = flags.tasks ? TASKS.filter((t) => String(flags.tasks).split(',').includes(t.id)) : TASKS;
  const repeat = Number(flags.repeat || 1);
  const jobs = [];
  for (let r = 0; r < repeat; r++) for (const t of tasks) for (const m of models) jobs.push({ t, m, r });
  console.log(c.dim(`bench: ${tasks.length} tasks × ${models.length} models × ${repeat} = ${jobs.length} calls`));

  const benchCfg = { ...cfg, timeouts: { geminiMs: 5 * 60_000, claudeMs: 5 * 60_000 } };
  const runJob = async ({ t, m, r }) => {
    const { res, rec } = await callAndLog(m.agent, { prompt: t.prompt, model: m.model, maxTurns: t.agentic ? 6 : 2 },
      { from: 'bench', category: t.category, tag: 'bench' }, benchCfg);
    const g = res.ok ? t.grade(res.text)
      : { pass: false, why: `${res.status}: ${(res.denied.join(', ') || res.error || '').slice(0, 80)}` };
    const mark = g.pass ? c.green('pass') : c.red('fail');
    console.log(`  ${mark} ${t.id.padEnd(20)} ${m.key.padEnd(20)} ${ms(res.durationMs).padStart(6)} ${tok(res.usage.total).padStart(6)}${g.why ? c.dim('  ' + g.why) : ''}`);
    return { task: t.id, category: t.category, model: m.key, agent: m.agent, run: r, pass: g.pass, why: g.why, status: res.status,
      durationMs: res.durationMs, tokens: res.usage.total, costUsd: rec.costUsd, claudeEquivUsd: rec.claudeEquivUsd };
  };
  // Separate pools so a slow agent doesn't starve the other; keep concurrency low to respect quotas.
  const [gem, cla] = await Promise.all([
    pool(jobs.filter((j) => j.m.agent === 'gemini'), Number(flags.concurrency || 3), runJob),
    pool(jobs.filter((j) => j.m.agent === 'claude'), 2, runJob),
  ]);
  const results = [...gem, ...cla];
  const report = analyze(results, models, tasks);
  printReport(report);

  const dir = path.join(tandemHome(), 'bench');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `${stamp}.json`);
  writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), models: models.map((m) => m.key), tasks: tasks.map((t) => t.id), results, report }, null, 2));
  if (flags.out) writeFileSync(flags.out, toMarkdown(report));
  console.log(c.dim(`\nraw results: ${file}${flags.out ? `\nmarkdown: ${flags.out}` : ''}`));
}

export function analyze(results, models, tasks) {
  const perModel = models.map((m) => {
    const rs = results.filter((r) => r.model === m.key);
    const n = rs.length || 1;
    return {
      model: m.key, agent: m.agent, runs: rs.length,
      passRate: rs.filter((r) => r.pass).length / n,
      avgMs: rs.reduce((s, r) => s + r.durationMs, 0) / n,
      avgTokens: rs.reduce((s, r) => s + r.tokens, 0) / n,
      // Real marginal spend: Claude usage only (Gemini is a flat subscription).
      claudeUsd: rs.reduce((s, r) => s + r.costUsd, 0),
      claudeEquivUsd: rs.reduce((s, r) => s + r.claudeEquivUsd, 0),
    };
  });

  // Per category: cheapest model that passes everything; Gemini (flat-rate) beats Claude on ties.
  const categories = [...new Set(tasks.map((t) => t.category))];
  const perCategory = categories.map((cat) => {
    const catTasks = tasks.filter((t) => t.category === cat);
    const ranked = models.map((m) => {
      const rs = results.filter((r) => r.model === m.key && r.category === cat);
      const n = rs.length || 1;
      return { model: m.key, agent: m.agent, passRate: rs.filter((r) => r.pass).length / n,
        claudeUsd: rs.reduce((s, r) => s + r.costUsd, 0) / n, avgMs: rs.reduce((s, r) => s + r.durationMs, 0) / n };
    }).sort((a, b) => b.passRate - a.passRate || a.claudeUsd - b.claudeUsd || a.avgMs - b.avgMs);
    // Compare against the routing table's pick for this category, not a re-route of the bench prompt.
    const rule = RULES.find((r) => r.category === cat);
    const routedKey = rule ? `${rule.agent}:${rule.model}` : 'gemini:flash';
    const routedRow = ranked.find((r) => r.model === routedKey);
    return { category: cat, best: ranked[0], routed: routedKey, routedPassRate: routedRow?.passRate ?? null,
      agrees: routedRow ? routedRow.passRate >= ranked[0].passRate : null };
  });
  return { perModel, perCategory };
}

function printReport({ perModel, perCategory }) {
  console.log('\n' + c.bold('Per model'));
  console.log(table(perModel.map((m) => [m.model, pct(m.passRate), ms(m.avgMs), tok(m.avgTokens), m.agent === 'claude' ? usd(m.claudeUsd) : c.dim('flat'), usd(m.claudeEquivUsd)]),
    ['model', 'pass', 'avg time', 'avg tok', 'claude $', 'claude-equiv $']));
  console.log('\n' + c.bold('Router check') + c.dim(' (best = highest pass rate, then lowest Claude spend, then fastest)'));
  console.log(table(perCategory.map((p) => [p.category, p.best.model, pct(p.best.passRate), p.routed, pct(p.routedPassRate),
    p.agrees == null ? c.dim('not benched') : p.agrees ? c.green('ok') : c.yellow('revise')]),
  ['category', 'best', 'pass', 'router picks', 'pass', 'verdict']));
}

export function toMarkdown({ perModel, perCategory }) {
  const lines = ['## Per model', '', '| model | pass | avg time | avg tokens | Claude $ | Claude-equiv $ |', '|---|---|---|---|---|---|'];
  for (const m of perModel) lines.push(`| ${m.model} | ${pct(m.passRate)} | ${ms(m.avgMs)} | ${tok(m.avgTokens)} | ${m.agent === 'claude' ? usd(m.claudeUsd) : 'flat'} | ${usd(m.claudeEquivUsd)} |`);
  lines.push('', '## Router check', '', '| category | best | pass | router picks | pass | verdict |', '|---|---|---|---|---|---|');
  for (const p of perCategory) lines.push(`| ${p.category} | ${p.best.model} | ${pct(p.best.passRate)} | ${p.routed} | ${pct(p.routedPassRate)} | ${p.agrees == null ? 'not benched' : p.agrees ? 'ok' : 'revise'} |`);
  return lines.join('\n') + '\n';
}
