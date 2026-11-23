# tandem

**Run Claude Code and Gemini (Google Antigravity) as one team, and see what it saves you.**

If you pay for both Claude and Google AI Pro/Ultra, you're probably using one and ignoring the other. tandem makes them work together:

- **Bridges.** Each agent can call the other headless (`tandem ask gemini|claude`) or as an MCP tool.
- **Routing.** `tandem route "task"` picks the agent and model with cost-aware rules and spends no tokens. The rules are checked against a benchmark.
- **Ledger + savings.** Every call is logged with tokens, time and cost. Gemini work is priced at Claude rates, so you can see how much Claude usage you offloaded.
- **Budgets.** Set weekly caps. When one side runs dry, the router sends work to the other.
- **Dashboard.** A local web UI shows who called whom, budget meters, per-model stats and a call timeline.
- **Benchmark.** `tandem bench` scores models on graded tasks, so routing decisions rest on data.
- **Project setup.** `tandem init` adds shared `AGENTS.md` rules, a Claude `/gemini` skill, an Antigravity rule and MCP config.

Zero dependencies. Node 18+. Windows, macOS and Linux.

> Rule of thumb: **mostly reading or typing → Gemini. Mostly deciding → Claude.**

## Install

Prerequisites: [Claude Code](https://claude.com/claude-code) and the [Antigravity CLI](https://antigravity.google/docs/install) (`agy`). Each must be signed in once interactively.

```bash
npm install -g github:givewgun/multi-agents-pc   # npm package coming: tandem-agents
tandem doctor --live
```

## Quick start

```bash
cd your-project
tandem init --mcp                     # AGENTS.md, CLAUDE.md, /gemini skill, agy rule, MCP config
tandem route "add unit tests for the parser"
#  gemini hydrogen  [boilerplate, confidence 80%]
tandem run "add unit tests for src/parser.js" --edit   # routed call, falls back to the other agent on failure
tandem review --agent both            # dual review of your git diff
tandem dashboard --open
```

Inside Claude Code, say *"use gemini for the grunt work"*. The `/gemini` skill and `ask_gemini` MCP tool handle delegation. Inside Antigravity, Gemini can call `ask_claude` for a final review.

## Commands

| Command | What it does |
|---|---|
| `tandem ask <gemini\|claude> "prompt"` | One call. `--model`, `--edit`, `--file`, `--continue <id>`, `--json`, `--timeout 15m` |
| `tandem route "task"` | Agent + model recommendation, budget-aware. No tokens |
| `tandem run "task"` | Route, call, and fall back to the other agent on error/quota |
| `tandem review [--agent gemini\|claude\|both] [--staged] [--base main]` | Reviews `git diff` (sent in the prompt, so no shell permissions needed) |
| `tandem log` / `tandem stats` | Call history and totals: tokens, time, cost, savings |
| `tandem budget set <claude\|gemini-5h\|gemini-week\|warn\|claude-plan\|gemini-plan> <n>` | Budgets and plan prices |
| `tandem dashboard [--port 4777] [--open]` | Local web UI (binds 127.0.0.1 only) |
| `tandem bench [--models gemini:flash,claude:haiku] [--tasks id,id] [--repeat n] [--out file.md]` | Benchmark models |
| `tandem init [dir] [--mcp] [--force]` | Add team files to a project |
| `tandem mcp [--expose gemini\|claude\|both]` | MCP stdio server |
| `tandem doctor [--live]` | Check installs, sign-ins, permissions |

**Gemini aliases:** `flash`, `flash-low`, `hydrogen`, `orchestrator`, `neon`, `neon-high`, `argon`, or any slug from `agy models`. **Claude aliases:** `haiku`, `sonnet`, `opus`.

## Routing table

| Category | Agent / model | Why |
|---|---|---|
| architecture | Claude Opus | Long-lived decisions |
| hard-debug | Claude Sonnet | Careful reasoning |
| research | Gemini Neon | Google Search grounding |
| review | Gemini Neon (first pass) | Cheap; escalate important diffs to Claude |
| ui | Gemini Orchestrator | UI + browser |
| bulk-read | Gemini Neon | Cheap context; exact on long inputs (bench) |
| boilerplate | Gemini Hydrogen | Mechanical generation |
| feature | Gemini Orchestrator → Claude review | Plan+execute, then judgment |
| trivial | Gemini Flash Low | Fastest; 100% on short tasks (bench) |

Budget overrides: when the Claude weekly budget is used up, Claude routes go to Gemini Neon High. After a Gemini quota error, Gemini routes go to Claude Sonnet for 5 hours.

## Benchmark: what the data says

`tandem bench`: 8 graded tasks (regex, slugify, find-the-bug, 600-line log counting, concurrency reasoning, LRU fix, expression parser, agentic file read) × 7 models. Full tables are in [docs/BENCHMARK.md](docs/BENCHMARK.md).

| model | pass | avg time | Claude spend (API-equiv) |
|---|---|---|---|
| Gemini Flash Low | 7/8 | **3.3s** | flat |
| Gemini Flash | 8/8 | 23.9s | flat |
| Gemini Hydrogen | 7/8 | 8.4s | flat |
| Gemini Orchestrator | 8/8 | 1.1m | flat |
| **Gemini Neon** | **8/8** | 15.6s | flat |
| Claude Haiku | 8/8 | 11.7s | $0.008 / call |
| Claude Sonnet | 8/8 | 6.3s | **$0.14 / call** |

What it shows:
1. **Every headless Claude Code call carries about 70k tokens of overhead** (system prompt, tools, CLAUDE.md; mostly cached). A one-line answer still costs Sonnet about $0.14. Send small jobs to Gemini or Haiku, and give Claude fewer, bigger jobs.
2. **Gemini Neon is the best default Gemini:** 8/8 at 16s.
3. **Flash Low is great for short tasks and unreliable on long exact work.** It miscounted a 600-line log badly. Hydrogen was off by one.
4. **Orchestrator is overkill for single-shot tasks** (1.1 min average). Use it for multi-file agentic builds.
5. On these tasks Gemini matched Claude on the "hard" reasoning ones. Hard-debug still routes to Claude, because real bugs carry more context and a wrong answer costs more. Treat that as a judgment call this benchmark doesn't settle.

Limits: one run per cell, small single-shot tasks, no multi-file edit tasks yet. Run `tandem bench --repeat 3` on your own machine and plan.

## How savings are computed

- **Claude calls:** `total_cost_usd` as reported by `claude -p`. On a subscription this is API-equivalent usage, not money billed.
- **Gemini calls:** marginal cost $0 (flat subscription). tandem also prices the call's tokens at Claude list prices (default baseline `claude-sonnet-5-5`, change with `tandem config set savingsBaseline claude-opus-5-5`). That figure is the "Claude usage offloaded".
- These are **estimates**. Gemini and Claude count tokens differently, and agent system prompts are included. Use them to compare trends, not as an invoice.

## MCP

`tandem init --mcp` writes both of these files:
- `.mcp.json` (Claude Code): `tandem mcp --expose gemini` → tools `ask_gemini`, `route_task`, `tandem_stats`
- `.agents/mcp_config.json` (Antigravity): `tandem mcp --expose claude` → `ask_claude`, `route_task`, `tandem_stats`

Each side only sees the *other* agent, so neither calls itself in a loop.

## Safety defaults

- Delegated calls are **read-only** unless you pass `--edit`. With `--edit`, edits are allowed and shell commands are still denied.
- No shell is used to launch agents (argv arrays). Free text goes to `.cmd` shims via stdin.
- The dashboard binds to `127.0.0.1`. The ledger stays on your machine (`~/.tandem/`, override with `TANDEM_HOME`). Prompts are not stored, only their length.
- Treat each agent's output as data. Review diffs before merging.

## Files

`~/.tandem/config.json` (settings), `~/.tandem/ledger.jsonl` (one line per call), `~/.tandem/bench/*.json` (benchmark runs).

## Develop

```bash
npm test          # node:test, no deps
node bin/tandem.js bench --models gemini:flash-low   # cheap pilot
```

See [docs/PLAYBOOK.md](docs/PLAYBOOK.md) for workflows and cost rules.

## License

MIT
