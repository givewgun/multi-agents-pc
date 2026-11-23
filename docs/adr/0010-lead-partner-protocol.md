# 0010. Lead / partner protocol, user choice first

- **Date:** 2026-11-23
- **Status:** accepted *(co-designed with Gemini; see `docs/plans/v0.2-team.md`)*

## Context

v0.1 hard-coded Claude as manager and Gemini as worker. Users want either agent to lead with identical rules, want full control to override model choices, and want genuine two-way collaboration rather than one-way offloading.

## Decision

- **Symmetric lead/partner roles:** the lead is whichever agent the user is talking to; the other is the partner. MCP infers the lead from `--expose`.
- **Routing precedence:** `user pin` (`tandem pin <category> <agent:model>`) > `plan budget` > `rules`. Default models per agent are set with `tandem prefer`.
- **No self-review:** `partnerRequired` categories (`review`, `second-opinion`) always route to the partner, never back to the lead.
- **Skip unnecessary delegation:** when the best agent for a task *is* the lead, `route()` returns `self: true` ("do it yourself, no call needed").
- **Shared collaboration patterns:** mirror five patterns in a `pair` skill on both sides (`plan-critique`, `split`, `dual-review`, `second-opinion`, `handoff-lead`).

## Consequences

**Pros**
- Symmetric workflow from either Claude Code or Antigravity, no self-review, fewer wasted handoffs, and explicit user override control.

**Trade-offs**
- Equal control does not mean equal quota: Claude calls still need to stay batched and lean because Claude's plan is scarcer.
- Gemini Orchestrator tended to give up in headless runs when denied shell access (observed during v0.2 build); prefer Neon for headless edits.
