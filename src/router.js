// Rule-based task router: zero tokens spent deciding who spends tokens.
// Principle: Claude thinks, Gemini lifts. Volume goes to Gemini; judgment stays with Claude.

export const RULES = [
  {
    category: 'architecture', agent: 'claude', model: 'opus', weight: 3,
    re: /\b(architect(ure)?|system design|design (the|a|an|our)|trade-?offs?|threat model|security (review|audit)|data model|schema design)\b/i,
    reason: 'Long-lived design decisions: worth Claude Opus.',
  },
  {
    category: 'hard-debug', agent: 'claude', model: 'sonnet', weight: 3,
    re: /\b(race condition|deadlock|memory leak|flaky|intermittent|heisenbug|root cause|segfault|corrupt(ion|ed)?|concurren(cy|t)|why (does|is|do)|not working after|regression)\b/i,
    reason: 'Hard debugging needs careful reasoning: Claude Sonnet.',
  },
  {
    category: 'research', agent: 'gemini', model: 'neon', weight: 2,
    re: /\b(latest|current version|newest|what'?s new|release notes|changelog of|compare|vs\.?|alternatives?|best (lib|library|tool|framework|way)|pricing|docs? for|deprecat)\b/i,
    reason: 'Fresh web facts: Gemini has Google Search grounding.',
  },
  {
    category: 'review', agent: 'gemini', model: 'neon', weight: 2,
    re: /\b(review|second opinion|critique|sanity.?check|look over|audit (this|the) (diff|pr|change))\b/i,
    reason: 'Cheap first-pass review on Gemini; escalate to Claude for important changes.',
  },
  {
    category: 'ui', agent: 'gemini', model: 'orchestrator', weight: 2,
    re: /\b(ui|ux|css|tailwind|html|frontend|front-end|component|landing page|mockup|layout|responsive|dark mode|icon|screenshot|browser test)\b/i,
    reason: 'UI work + browser testing: Gemini Orchestrator.',
  },
  {
    category: 'bulk-read', agent: 'gemini', model: 'hydrogen', weight: 2,
    re: /\b(summari[sz]e|map (the|this)? ?(repo|codebase|project)|explain (the|this)? ?(codebase|repo|project)|read (all|every|these)|scan|inventory|find (all|every)|list (all|every)|where is|grep|logs?)\b/i,
    reason: 'Reading lots of material: Gemini context is cheap.',
  },
  {
    category: 'boilerplate', agent: 'gemini', model: 'hydrogen', weight: 2,
    re: /\b(boilerplate|scaffold|unit tests?|write tests|add tests|test cases|crud|migration|rename|docstrings?|jsdoc|readme|changelog|comments?|format|convert|port (this|to)|translate|upgrade (deps|dependencies|packages?)|types? for)\b/i,
    reason: 'Mechanical generation: Gemini Hydrogen is built for it.',
  },
  {
    category: 'feature', agent: 'gemini', model: 'orchestrator', weight: 1,
    re: /\b(implement|build|create|add (a|an|the)? ?(feature|endpoint|page|command|flag|option)|refactor)\b/i,
    reason: 'Feature build: Gemini Orchestrator plans+executes; have Claude review the diff.',
  },
  {
    category: 'trivial', agent: 'gemini', model: 'flash', weight: 1,
    re: /\b(typo|one-?liner|regex for|what is|how do i|command to|quick question|commit message)\b/i,
    reason: 'Trivial: cheapest model.',
  },
];

/**
 * @param {string} task
 * @param {object} [budget] summarize(...).budget, to steer away from exhausted pools
 */
export function route(task, budget = null) {
  const scores = new Map();
  for (const rule of RULES) {
    const hits = task.match(new RegExp(rule.re.source, 'gi'));
    if (hits) scores.set(rule, (scores.get(rule) || 0) + rule.weight * hits.length);
  }
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  let pick;
  if (ranked.length) {
    const [rule, score] = ranked[0];
    const runnerUp = ranked[1]?.[1] || 0;
    pick = {
      category: rule.category, agent: rule.agent, model: rule.model, reason: rule.reason,
      confidence: Math.min(0.95, 0.5 + (score - runnerUp) * 0.15),
    };
  } else if (task.length < 160) {
    pick = { category: 'trivial', agent: 'gemini', model: 'flash', reason: 'Short, unclassified: cheapest model.', confidence: 0.4 };
  } else {
    pick = { category: 'general', agent: 'gemini', model: 'neon', reason: 'Unclassified: Gemini first, escalate to Claude if weak.', confidence: 0.3 };
  }
  pick.alternatives = ranked.slice(1, 3).map(([r]) => ({ category: r.category, agent: r.agent, model: r.model }));
  pick.notes = [];

  if (budget) {
    const warn = budget.warnAt ?? 0.8;
    if (pick.agent === 'claude' && budget.claudeWeek?.ratio != null && budget.claudeWeek.ratio >= 1) {
      pick.notes.push(`Claude weekly budget used (${pct(budget.claudeWeek.ratio)}): sending to Gemini Neon High instead.`);
      Object.assign(pick, { agent: 'gemini', model: 'neon-high' });
    } else if (pick.agent === 'gemini' && (budget.geminiLikelyLimited || (budget.gemini5h?.ratio ?? 0) >= 1)) {
      pick.notes.push('Gemini quota likely exhausted (recent quota error or 5h cap): falling back to Claude Sonnet.');
      Object.assign(pick, { agent: 'claude', model: 'sonnet' });
    } else if (pick.agent === 'claude' && (budget.claudeWeek?.ratio ?? 0) >= warn) {
      pick.notes.push(`Claude weekly budget at ${pct(budget.claudeWeek.ratio)}: consider Gemini.`);
    }
  }
  return pick;
}

const pct = (r) => `${Math.round(r * 100)}%`;
