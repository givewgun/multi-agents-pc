// Team-vs-solo benchmark: same graded tasks, different collaboration strategies.
// Measures final quality (hidden-test score) against Claude spend, wall time and call count.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { TASKS } from './tasks.js';
import { HARD_TASKS } from './hard-tasks.js';
import { callAndLog } from '../cli.js';
import { tandemHome } from '../config.js';
import { usd, tok, ms, pct, c, table } from '../format.js';

const DIRECT = 'Answer directly from the information below. Do not use any tools, files, or shell commands.\n\n';

export function extractCode(text) {
  const m = /```(?:js|javascript)?\s*([\s\S]*?)```/i.exec(text || '');
  return (m ? m[1] : text || '').trim();
}

/** Reviewer prompt: approve with LGTM (cheap) or return full corrected code. */
export function reviewPrompt(task, draft) {
  return `${DIRECT}A teammate wrote code for the task below. Check it carefully against every rule in the spec, especially edge cases.
If it is fully correct, reply with exactly: LGTM
Otherwise reply with the complete corrected code in one \`\`\`js block, code only.

--- TASK ---
${task.prompt}

--- CANDIDATE ---
\`\`\`js
${extractCode(draft)}
\`\`\``;
}

export function planPrompt(task) {
  return `${DIRECT}You are the tech lead. Do NOT write the implementation. List the edge cases and pitfalls an implementer is most likely to get wrong for the task below, as terse bullets (max 120 words, no code).

--- TASK ---
${task.prompt}`;
}

export function withPlan(task, plan) {
  return `${task.prompt}\n\nYour tech lead flagged these pitfalls — handle every one:\n${plan.trim()}`;
}

/** Final answer after review: draft if reviewer approved (or failed), else reviewer's code. */
export function applyReview(draft, review) {
  if (!review.ok) return { text: draft, draft, degraded: true };
  const t = review.text.trim();
  if (/^\W*LGTM\W*$/i.test(t) || !/```/.test(t)) return { text: draft, draft, approved: true };
  return { text: t, draft, approved: false };
}

const G = (model) => ({ agent: 'gemini', model });
const C = (model) => ({ agent: 'claude', model });

/**
 * Each strategy: (task, call) -> { text, approved?, degraded? }. `call(who, prompt)` returns res.
 * Kept small so cost stays low: at most one Claude call per task per strategy.
 */
export const STRATEGIES = {
  'solo-gemini': {
    desc: 'Gemini Flash alone',
    async run(t, call) { return { text: (await call(G('flash'), t.prompt)).text }; },
  },
  'solo-claude': {
    desc: 'Claude Sonnet alone',
    async run(t, call) { return { text: (await call(C('sonnet'), t.prompt)).text }; },
  },
  'gemini-pair': {
    desc: 'Flash drafts → Neon reviews/fixes (0 Claude)',
    async run(t, call) {
      const d = await call(G('flash'), t.prompt);
      if (!d.ok) return { text: d.text };
      return applyReview(d.text, await call(G('neon'), reviewPrompt(t, d.text)));
    },
  },
  'draft-review': {
    desc: 'Flash drafts → Sonnet reviews/fixes',
    async run(t, call) {
      const d = await call(G('flash'), t.prompt);
      if (!d.ok) return { text: d.text };
      return applyReview(d.text, await call(C('sonnet'), reviewPrompt(t, d.text)));
    },
  },
  'plan-execute': {
    desc: 'Sonnet lists pitfalls → Flash implements',
    async run(t, call) {
      const p = await call(C('sonnet'), planPrompt(t));
      return { text: (await call(G('flash'), p.ok ? withPlan(t, p.text) : t.prompt)).text, degraded: !p.ok };
    },
  },
};

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

export function scoreOf(g) { return typeof g.score === 'number' ? g.score : g.pass ? 1 : 0; }

export async function teamBench(flags, cfg) {
  const all = [...HARD_TASKS, ...TASKS];
  const tasks = flags.tasks ? all.filter((t) => String(flags.tasks).split(',').includes(t.id)) : HARD_TASKS;
  if (!tasks.length) throw new Error(`No matching tasks. Available: ${all.map((t) => t.id).join(', ')}`);
  const names = flags.strategies ? String(flags.strategies).split(',') : Object.keys(STRATEGIES);
  const bad = names.find((n) => !STRATEGIES[n]);
  if (bad) throw new Error(`Unknown strategy "${bad}". Available: ${Object.keys(STRATEGIES).join(', ')}`);
  const repeat = Number(flags.repeat ?? 1);
  if (!Number.isInteger(repeat) || repeat < 1) throw new Error('--repeat must be a positive integer');
  const concurrency = Number(flags.concurrency ?? 3);

  const jobs = [];
  for (let r = 0; r < repeat; r++) for (const t of tasks) for (const s of names) jobs.push({ t, s, r });
  console.log(c.dim(`team bench: ${tasks.length} tasks × ${names.length} strategies × ${repeat} = ${jobs.length} runs`));
  const benchCfg = { ...cfg, timeouts: { geminiMs: 5 * 60_000, claudeMs: 5 * 60_000 } };

  const results = await pool(jobs, concurrency, async ({ t, s, r }) => {
    const calls = [];
    const call = async ({ agent, model }, prompt) => {
      const { res, rec } = await callAndLog(agent, { prompt, model, maxTurns: 2 },
        { from: 'bench', category: t.category, tag: `bench-team:${s}` }, benchCfg);
      calls.push({ agent, model, ok: res.ok, status: res.status, ms: res.durationMs, tokens: res.usage.total, costUsd: rec.costUsd });
      return res;
    };
    let out;
    try { out = await STRATEGIES[s].run(t, call); } catch (e) { out = { text: '', degraded: true, error: e.message }; }
    // Infra failure: the call that produced the final answer failed (timeout/quota/error).
    // A failed review falls back to the draft (degraded), which is graded normally.
    const last = calls[calls.length - 1];
    const infra = !out.text || (!!last && !last.ok && !out.degraded);
    const g = infra ? { pass: false, score: 0, why: out.error || last?.status || 'no output' } : t.grade(out.text);
    const draftScore = out.draft != null && out.approved === false ? scoreOf(t.grade(out.draft)) : null;
    const row = {
      task: t.id, strategy: s, run: r, score: scoreOf(g), pass: g.pass, why: g.why || '',
      approved: out.approved ?? null, degraded: !!out.degraded, infra, draftScore,
      ms: calls.reduce((a, k) => a + k.ms, 0),
      claudeUsd: calls.reduce((a, k) => a + (k.agent === 'claude' ? k.costUsd : 0), 0),
      claudeTokens: calls.reduce((a, k) => a + (k.agent === 'claude' ? k.tokens : 0), 0),
      geminiCalls: calls.filter((k) => k.agent === 'gemini').length,
      claudeCalls: calls.filter((k) => k.agent === 'claude').length,
      calls,
    };
    const mark = row.pass ? c.green('pass') : row.score > 0 ? c.yellow(pct(row.score).padStart(4)) : c.red('fail');
    console.log(`  ${mark} ${t.id.padEnd(20)} ${s.padEnd(14)} ${ms(row.ms).padStart(6)} ${usd(row.claudeUsd).padStart(8)}${row.approved === true ? c.dim(' LGTM') : row.approved === false ? c.dim(' fixed') : ''}${row.why ? c.dim('  ' + row.why.slice(0, 80)) : ''}`);
    return row;
  });

  const report = analyzeTeam(results, names, tasks);
  printTeam(report);
  const dir = path.join(tandemHome(), 'bench');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `team-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), strategies: names, tasks: tasks.map((t) => t.id), results, report }, null, 2));
  if (flags.out) writeFileSync(flags.out, teamMarkdown(report));
  console.log(c.dim(`\nraw results: ${file}${flags.out ? `\nmarkdown: ${flags.out}` : ''}`));
}

export function analyzeTeam(results, names, tasks) {
  const avg = (rs, f) => rs.reduce((a, r) => a + f(r), 0) / (rs.length || 1);
  const perStrategy = names.map((s) => {
    const rs = results.filter((r) => r.strategy === s);
    const reviewed = rs.filter((r) => r.approved !== null);
    return {
      strategy: s, desc: STRATEGIES[s].desc, runs: rs.length,
      avgScore: avg(rs, (r) => r.score), passRate: avg(rs, (r) => (r.pass ? 1 : 0)),
      avgMs: avg(rs, (r) => r.ms), claudeUsd: rs.reduce((a, r) => a + r.claudeUsd, 0),
      claudeTokens: avg(rs, (r) => r.claudeTokens),
      fixRate: reviewed.length ? reviewed.filter((r) => r.approved === false).length / reviewed.length : null,
      // Of reviewer rewrites: how many turned a failing draft into a better one, vs. churned a passing one.
      realFixes: rs.filter((r) => r.approved === false && r.draftScore != null && r.score > r.draftScore).length,
      churn: rs.filter((r) => r.approved === false && r.draftScore === 1).length,
      infra: rs.filter((r) => r.infra).length,
      // Quality excluding infra failures (timeouts/quota), so reliability and correctness read separately.
      scoreExInfra: avg(rs.filter((r) => !r.infra), (r) => r.score),
      degraded: rs.filter((r) => r.degraded).length,
    };
  });
  const perTask = tasks.map((t) => ({ task: t.id, scores: Object.fromEntries(names.map((s) => [s, avg(results.filter((r) => r.task === t.id && r.strategy === s), (r) => r.score)])) }));
  return { perStrategy, perTask, names };
}

function printTeam({ perStrategy, perTask, names }) {
  console.log('\n' + c.bold('Per strategy'));
  console.log(table(perStrategy.map((p) => [p.strategy, pct(p.avgScore), pct(p.scoreExInfra), String(p.infra), ms(p.avgMs), usd(p.claudeUsd), rewrites(p), p.desc]),
    ['strategy', 'score', 'ex-infra', 'infra fails', 'avg time', 'claude $', 'rewrites (real/churn)', 'how']));
  console.log('\n' + c.bold('Per task (avg hidden-test score)'));
  console.log(table(perTask.map((t) => [t.task, ...names.map((s) => pct(t.scores[s]))]), ['task', ...names]));
}

const rewrites = (p) => (p.fixRate == null ? '-' : `${pct(p.fixRate)} (${p.realFixes}/${p.churn})`);

export function teamMarkdown({ perStrategy, perTask, names }) {
  const L = ['## Per strategy', '', '| strategy | how | score | score ex-infra | infra fails | avg time | Claude $ (total) | reviewer rewrites (real fix / churn) |', '|---|---|---|---|---|---|---|---|'];
  for (const p of perStrategy) L.push(`| ${p.strategy} | ${p.desc} | ${pct(p.avgScore)} | ${pct(p.scoreExInfra)} | ${p.infra} | ${ms(p.avgMs)} | ${usd(p.claudeUsd)} | ${rewrites(p)} |`);
  L.push('', '## Per task (avg hidden-test score)', '', `| task | ${names.join(' | ')} |`, `|---|${names.map(() => '---').join('|')}|`);
  for (const t of perTask) L.push(`| ${t.task} | ${names.map((s) => pct(t.scores[s])).join(' | ')} |`);
  return L.join('\n') + '\n';
}
