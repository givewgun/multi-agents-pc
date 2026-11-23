# 0005. Rule-based router, validated by benchmark

- **Date:** 2026-11-23
- **Status:** accepted

## Context

Using an LLM to route tasks spends tokens and adds latency on every call, which works against the point of routing. Hand-written rules can be wrong, however, if they are never checked against data.

## Decision

- Use weighted regex rules in `src/router.js` (0 tokens spent).
- Apply plan-budget overrides on top of rules: when Claude's window hits its cap, route to Gemini Neon High; when Gemini's window hits its cap (or after a recent Gemini quota error), route to Claude Sonnet (see [0009](0009-plan-window-budgets.md)).
- Pair every rule category with at least one graded task in `tandem bench`. `tandem bench` reports `ok`/`revise` per category, and routing changes require benchmark evidence.
- First benchmark-driven tuning: `bulk-read` moved from Hydrogen → Neon; `trivial` moved from Flash → Flash Low.

## Consequences

**Pros**
- Zero-token, fast, explainable, and unit-testable routing.

**Trade-offs**
- Keyword matching can miss nuanced intent. Mitigated by returning `confidence` + `alternatives`, plus `--model`, `tandem prefer`, and `tandem pin`.
- Current bench tasks are small single-shot puzzles; keeping `hard-debug` on Claude remains a judgment call until multi-file benchmarks exist.
