# 0006. Local ledger and savings estimate

- **Date:** 2026-11-23
- **Status:** accepted *(budget portion superseded by [0009](0009-plan-window-budgets.md))*

## Context

Users want visibility into how much work each agent did and how much Claude quota was offloaded. However, Gemini is a flat-rate subscription and Claude subscriptions report API-equivalent `total_cost_usd` rather than billed dollars.

## Decision

- Append one JSONL record per call to `~/.tandem/ledger.jsonl` (overridable via `TANDEM_HOME`).
- Store metadata only: prompt character length and transcript pointer, never prompt text.
- Record Claude cost as `total_cost_usd`. Estimate Gemini "Claude usage offloaded" by pricing delegated Gemini tokens at `savingsBaseline` list prices (default `claude-sonnet-5-5`, counting thinking tokens as output).
- *(Superseded by [0009](0009-plan-window-budgets.md)):* v0.1 budgeted Claude in API-equivalent USD/week and Gemini by call counts.

## Consequences

**Pros**
- Private, local-only, greppable, and crash-resilient (torn last lines are skipped).

**Trade-offs**
- Savings numbers are estimates (different tokenizers, agent system prompts included) and are explicitly labeled `est.` everywhere.
