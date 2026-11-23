# Claude + Gemini Playbook

Two subscriptions, one team — for **better catch rate** and **longer uninterrupted flow**, not just stretching quota.

- **Quality:** different model families don't share the same blind spots. Use cross-model review for plans and diffs, and bring in the partner after 2 failed debug attempts to break tunnel vision.
- **Flow & capacity:** Claude's 5-hour/weekly limits are tighter; Gemini (Google AI Pro / Ultra via Antigravity) has generous context, Google Search grounding, and browser/UI tools. Split work by strength so you stay in flow instead of hitting reset walls.
- **When to stay solo:** small, tightly-coupled edits where one agent already holds the full mental model — passing context across agents adds latency and lossy summaries.

`tandem` wires the two together and lets you measure what's actually paying off.

## 1. Surfaces

| Surface | Use it for |
|---|---|
| **Claude Code** | Lead engineer: plans, hard bugs, precise edits, final review |
| **Antigravity app** | Parallel Gemini agents, browser testing, UI work, scheduled automations |
| **`agy` CLI** | Headless Gemini. What `tandem ask gemini` drives |
| **Gemini app** | Deep Research reports, quick questions, images/video |
| **NotebookLM** | Q&A over your PDFs, specs, course material |

### Gemini model picker (AI Pro)

| alias → agy slug | Use for |
|---|---|
| `flash` → `gemini-3.8-flash-medium` (`flash-low` for less thinking) | Trivial lookups, summaries, commit messages |
| `hydrogen` → `gemini-4-hydrogen-medium` | Boilerplate, unit tests, upgrades, renames |
| `orchestrator` → `gemini-pro-orchestrator-neon` | Multi-file features and fixes: Neon plans, Hydrogen executes |
| `neon` → `gemini-4-neon-medium` (`neon-high`) | Hard reasoning, reviews, second opinions. 512K context |
| `argon` → `gemini-4-argon-medium` | Alternative top reasoner |

Don't pick `claude-*` models inside Antigravity: on AI Pro they're a paid add-on, and you already have Claude. Gemini 4 Carbon is Ultra-only. Check quota with `/usage` inside `agy`.

## 2. Who does what

| Task | Owner | Command |
|---|---|---|
| Architecture, spec, threat model | Claude Opus | `tandem ask claude "..." --model opus` |
| Hard bug (race, leak, flaky) | Claude Sonnet | `tandem ask claude "..."` |
| Read/summarize a big codebase or logs | Gemini Neon | `tandem ask gemini "..." --model neon` |
| "Latest version / best lib / what changed" | Gemini Neon | `tandem ask gemini "..." --model neon` |
| Boilerplate, tests, migrations, renames | Gemini Hydrogen | `... --model hydrogen --edit` |
| Feature build | Gemini Orchestrator, then Claude reviews | `tandem run "..." --edit` then `tandem review --agent claude` |
| UI + browser testing | Gemini in the Antigravity app | |
| Code review before merge | Both | `tandem review --agent both` |
| Recurring jobs | Antigravity scheduled automations | Gemini quota, not Claude |

Unsure? `tandem route "task"`. It spends no tokens.

## 3. Combo workflows

- **A. Plan → Build → Review:** Claude writes the plan to `handoffs/inbox/`. Gemini builds it (`--edit`) and you commit. Then `tandem review --agent claude`.
- **B. Scout → Strike:** Gemini maps the repo in under 400 words. Claude reads only the files that matter.
- **C. Research → Decide:** Gemini (or Deep Research) gathers sources. Claude picks and plans.
- **D. Dual review:** `tandem review --agent both`. Where the two disagree, look closely.
- **E. Stuck bug:** after 2 failed attempts, ask the other agent for 3 alternative hypotheses.
- **F. Parallel sprint:** several Gemini agents in the Antigravity app on independent file sets. Claude reviews each result.
- **G. Night shift:** a scheduled Antigravity automation runs tests and lint, then writes a report to `handoffs/inbox/`. In the morning, Claude processes the inbox.

## 4. Cost rules

1. Gemini first for volume: reading more than 10 files, generating more than 200 lines, web lookups.
2. Smallest model that works: Flash → Hydrogen → Orchestrator → Neon; Haiku → Sonnet → Opus. `tandem bench` tells you where each one starts failing.
3. Self-contained handoffs. A vague handoff costs a retry on both sides.
4. Ask for summaries, not dumps ("<300 words").
5. Both plans meter a rolling 5-hour and weekly window. `tandem usage` shows both. Tune how much of each window tandem may use: `tandem budget set claude-5h 70%` keeps 30% of your Claude window for interactive work. The router steers away from a full plan.
6. Watch `tandem dashboard`. If Gemini's share is low, you're paying Claude for typing.
