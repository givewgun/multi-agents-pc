# 0005. Rule-based router, validated by benchmark

Date: 2026-11-23 · Status: accepted

**Context:** Routing with an LLM costs tokens on every task, which defeats the purpose. Rules can be wrong, though.
**Decision:** Weighted regex rules in `src/router.js`. Budget overrides: Claude weekly cap hit → Gemini Neon High; recent Gemini quota error or 5h cap → Claude Sonnet. Every rule category gets ≥1 graded bench task. `tandem bench` reports "ok/revise" per category, and rules change only on bench evidence. First tuning: bulk-read Hydrogen → Neon, trivial Flash → Flash Low.
**Consequences:** + 0-token, explainable, testable routing. − Keyword matching misses intent. `route` returns confidence + alternatives, and callers can override `--model`. Bench tasks are small single-shot: hard-debug stays on Claude by judgment, not data.
