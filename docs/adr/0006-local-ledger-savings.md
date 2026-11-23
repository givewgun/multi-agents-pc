# 0006. Local ledger and savings estimate

Date: 2026-11-23 · Status: accepted

**Context:** The user wants to see cost savings, but Gemini is flat-rate and Claude subscriptions report API-equivalent `total_cost_usd`, not billed money.
**Decision:** Append one JSONL record per call to `~/.tandem/ledger.jsonl` (`TANDEM_HOME` overrides). Store metadata only: prompt length, never prompt text. Claude cost = `total_cost_usd`. Gemini "offloaded" = its tokens priced at `savingsBaseline` (default Sonnet 5.5) list price, thinking counted as output. Budgets: Claude in API-equiv USD per 7 days, Gemini in call counts per 5h/7d (its quota is opaque).
**Consequences:** + private, greppable, survives crashes (torn lines skipped). − Savings is an estimate (different tokenizers, agent system prompts included). Labelled "est." everywhere.
