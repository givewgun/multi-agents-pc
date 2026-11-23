# 0010. Lead / partner protocol, user choice first

Date: 2026-11-23 · Status: accepted (co-designed with Gemini, docs/plans/v0.2-team.md)

**Context:** v0.1 hard-coded Claude as manager and Gemini as worker. The user wants either agent to lead with identical behaviour, wants to pick models manually, and wants real collaboration, not just offloading.
**Decision:** The lead is the agent the user is talking to; the other is the partner. `route(task, budget, {lead, pins})`: a user pin (`tandem pin <category> <agent:model>`) beats the budget, which beats the rules. `partnerRequired` categories (review, second-opinion) never go to the lead. If the best agent is the lead, the result is `self: true` ("do it yourself", no call). Five patterns, mirrored in a `pair` skill on each side: plan-critique, split, dual-review, second-opinion, handoff-lead. Defaults: `tandem prefer`. MCP sets the lead from `--expose`.
**Consequences:** + symmetric, no self-review, fewer pointless calls, user in control. − "Equal control ≠ equal spend": Claude calls stay batched and small because Claude's plan is scarcer. Gemini's Orchestrator model tends to give up in headless runs when it wants a shell (seen once in the v0.2 build); prefer Neon for headless edits.
