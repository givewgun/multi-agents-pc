// Rule-based task router: zero tokens spent deciding who spends tokens.
// Rules say which agent is *better/cheaper* at a kind of work. Who leads is separate: the lead is
// whichever agent the user is talking to, and it does work itself when it's the best fit.

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
    category: 'review', agent: 'gemini', model: 'neon', weight: 2, partnerRequired: true,
    re: /\b(review|look over|audit (this|the) (diff|pr|change))\b/i,
    reason: 'Review by the other agent; Gemini Neon is a cheap first pass, escalate important changes to Claude.',
  },
  {
    category: 'second-opinion', agent: 'gemini', model: 'neon', weight: 2, partnerRequired: true,
    re: /\b(second opinion|critique|sanity.?check|poke holes|devil'?s advocate|alternative (hypothes[ie]s|approach(es)?)|what am i missing)\b/i,
    reason: 'A second opinion must come from the other agent.',
  },
  {
    category: 'ui', agent: 'gemini', model: 'orchestrator', weight: 2,
    re: /\b(ui|ux|css|tailwind|html|frontend|front-end|component|landing page|mockup|layout|responsive|dark mode|icon|screenshot|browser test)\b/i,
    reason: 'UI work + browser testing: Gemini Orchestrator.',
  },
  {
    // Bench: Hydrogen and Flash Low miscounted a 600-line log; Neon was exact and fastest of the passers.
    category: 'bulk-read', agent: 'gemini', model: 'neon', weight: 2,
    re: /\b(summari[sz]e|map (the|this)? ?(repo|codebase|project)|explain (the|this)? ?(codebase|repo|project)|read (all|every|these)|scan|inventory|find (all|every)|list (all|every)|where is|grep|logs?)\b/i,
    reason: 'Reading lots of material: Gemini context is cheap; Neon stays exact on long inputs.',
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
    // Bench: Flash Low passed every short task at ~3s; avoid it for long inputs (see bulk-read).
    category: 'trivial', agent: 'gemini', model: 'flash-low', weight: 1,
    re: /\b(typo|one-?liner|regex for|what is|how do i|command to|quick question|commit message)\b/i,
    reason: 'Trivial: fastest model, 100% on short benchmark tasks.',
  },
];

const OTHER = { claude: 'gemini', gemini: 'claude' };
const PARTNER_MODEL = { claude: 'sonnet', gemini: 'neon' };

/** "claude:opus" | "gemini" → {agent, model} */
export function parsePin(s) {
  const [agent, model] = String(s).split(':');
  if (agent !== 'claude' && agent !== 'gemini') throw new Error(`Bad pin "${s}" (use claude:<model> or gemini:<model>)`);
  return { agent, model: model || PARTNER_MODEL[agent] };
}

/**
 * Order of precedence: user pin > budget > rules. Then lead logic:
 *  - partnerRequired categories (review, second opinion) never go to the lead itself;
 *  - otherwise, if the best agent IS the lead, `self: true` = do it yourself, no call.
 * @param {string} task
 * @param {object} [budget] planBudget(...) — plan-window usage per agent
 * @param {{lead?: 'claude'|'gemini', pins?: Record<string,string>}} [opts]
 */
export function route(task, budget = null, { lead = null, pins = {} } = {}) {
  const pick = rulePick(task);
  const pin = pins && Object.hasOwn(pins, pick.category) ? parsePin(pins[pick.category]) : null;
  if (pin) {
    Object.assign(pick, pin, { pinned: true, reason: `Pinned by you: ${pick.category} → ${pin.agent}:${pin.model}.` });
  }
  const rule = RULES.find((r) => r.category === pick.category);
  pick.partnerRequired = !!rule?.partnerRequired;
  if (lead) pick.lead = lead;
  // Partner first, budget second: the budget check must look at the agent that will actually run.
  if (lead && pick.partnerRequired && pick.agent === lead && !pick.pinned) {
    pick.notes.push(`${pick.category} must come from the partner, not the lead (${lead}).`);
    Object.assign(pick, { agent: OTHER[lead], model: PARTNER_MODEL[OTHER[lead]] });
  }
  applyBudget(pick, budget);
  if (lead) {
    pick.self = pick.agent === lead;
    if (pick.self) pick.notes.push(`You (${lead}) are the best fit: do it yourself, no call needed.`);
  }
  return pick;
}

function rulePick(task) {
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
    pick = { category: 'trivial', agent: 'gemini', model: 'flash-low', reason: 'Short, unclassified: fastest model.', confidence: 0.4 };
  } else {
    pick = { category: 'general', agent: 'gemini', model: 'neon', reason: 'Unclassified: Gemini first, escalate to Claude if weak.', confidence: 0.3 };
  }
  pick.alternatives = ranked.slice(1, 3).map(([r]) => ({ category: r.category, agent: r.agent, model: r.model }));
  pick.notes = [];
  return pick;
}

function applyBudget(pick, budget) {
  // budget = planBudget(...): plan-window usage vs. limits for each agent.
  if (budget) {
    const c = budget.claude || {};
    const g = budget.gemini || {};
    const out = pick.agent === 'claude' ? c.exhausted : g.exhausted;
    if (out && (pick.pinned || (pick.partnerRequired && pick.lead && pick.agent !== pick.lead))) {
      // Never send a review back to the lead (self-review) or override the user's pin: warn instead.
      pick.notes.push(`${pick.pinned ? 'Your pin keeps' : 'A partner review needs'} ${pick.agent}, but its plan is at tandem's limit.`);
    } else if (c.exhausted && g.exhausted) {
      pick.notes.push(`Both plans at their limits (Claude ${windows(c)}, Gemini ${windows(g)}): keeping the original pick.`);
    } else if (pick.agent === 'claude' && c.exhausted) {
      pick.notes.push(`Claude plan at its limit (${windows(c)}): sending to Gemini Neon High instead.`);
      Object.assign(pick, { agent: 'gemini', model: 'neon-high' });
    } else if (pick.agent === 'gemini' && g.exhausted) {
      pick.notes.push(`Gemini plan at its limit (${windows(g)}${budget.geminiQuotaHitAt ? ', recent quota error' : ''}): falling back to Claude Sonnet.`);
      Object.assign(pick, { agent: 'claude', model: 'sonnet' });
    } else if (pick.agent === 'claude' && c.warn) {
      pick.notes.push(`Claude plan getting full (${windows(c)}): consider Gemini.`);
    }
  }
}

const pct = (r) => `${Math.round(r * 100)}%`;
const windows = (s) => (s.known ? `5h ${pct(s.fiveHour?.used ?? 0)}, week ${pct(s.weekly?.used ?? 0)}` : 'usage unknown');
