# 0013. Opt-in delegation, with a hard solo switch

- **Date:** 2026-11-23
- **Status:** accepted *(solo folded into [0014](0014-session-mode-hooks.md))*

## Context

Skills and rules invited each agent to call the other on its own ("when a task is large and mechanical", "review", "second opinion"). The user found that unpredictable: sometimes they want one agent only (deep work with Claude), and surprise delegation costs time and trust. Skill wording is a soft hint an agent can still ignore, so wording alone cannot guarantee single-agent work.

## Decision

- **Opt-in by default.** Skill descriptions and AGENTS rules on both sides: delegate only when the user asks (`/gemini`, `/pair`, `ask-claude`, "ask/work with gemini/claude"). Otherwise work alone and *offer* a partner review instead of calling.
- **"use tandem freely"** is the explicit grant for judgment-based delegation for that task: the lead decomposes, classifies (0012), routes and verifies. `bench --agentic` team hints include the phrase.
- **Hard switch:** `tandem solo on [--for <duration>]` (now shorthand for `tandem mode solo`, writing `mode: {value: 'solo', until}` in user config; see [0014](0014-session-mode-hooks.md)). While on, MCP `ask_*` returns an error and CLI `ask`/`run`/`review` refuse, whoever calls them: tandem can't reliably tell Antigravity's shell calls from the user's terminal. `bench --agentic` refuses team setups. Plain `bench` and `route` still work (measurement and advice, not delegation).
- Visible in `tandem stats`, `tandem_stats` and the dashboard; `--for` keeps it from silently staying on.

## Consequences

**Pros**
- Predictable: each agent works alone unless asked; solo mode is a guarantee, not a hint.

**Trade-offs**
- Fewer automatic savings: the user must opt in for big reading/typing tasks to reach Gemini.
- Solo also blocks the user's own `tandem ask` until `tandem mode ask` (or `tandem solo off`).
