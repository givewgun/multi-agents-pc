# 0009. Budgets are plan windows, not dollars

- **Date:** 2026-11-23
- **Status:** accepted *(supersedes the budget portion of [0006](0006-local-ledger-savings.md))*

## Context

Both agents are flat-rate subscriptions metered by rolling windows (5-hour + weekly), not API dollars. v0.1 budgeted Claude in API-equivalent USD/week and Gemini by call counts, which could not tell how close either plan was to hitting a real limit.

Verified CLI telemetry:
- `claude -p --output-format stream-json --verbose` emits `rate_limit_event.rate_limit_info.unifiedWindows.{five_hour,seven_day}.{utilization,resetsAt}` on every call.
- `agy -p /usage --output-format json` returns `command.data.groups[].buckets[]{window: 5h|weekly, remaining_fraction, reset_time}` for free (0 tokens).
- Claude has no free equivalent (`claude -p /usage` goes to the model and is billed).

## Decision

- `src/usage.js` caches the latest snapshot per agent in `~/.tandem/usage.json`.
- Refresh Gemini's snapshot automatically when older than 5 minutes (free).
- Capture Claude's snapshot as a side effect of every Claude call, or via an explicit `tandem usage --refresh-claude` (~$0.006 Haiku ping).
- Treat any window past its `resetsAt` timestamp as `0` used.
- Configure limits as fractions of each window (`budgets.claude5h: 0.8`, `claudeWeek: 0.85`, `gemini5h`/`geminiWeek: 0.95`, `warnAt: 0.7 × limit`). Claude's caps default lower to preserve headroom for interactive Claude Code sessions.
- Reroute when a plan hits its cap or reports `rejected`; a Gemini quota error within the last 5h also marks Gemini exhausted. Keep dollar numbers as informational "value offloaded" only.

## Consequences

**Pros**
- Budgets track what actually runs out, including interactive work done outside `tandem` (both readings are plan-wide).

**Trade-offs**
- Claude's reading can go stale between Claude calls (age is displayed in CLI and dashboard).
- Legacy v0.1 config keys (`claudeWeeklyUsd`, `gemini5hCalls`, `geminiWeeklyCalls`) are ignored.
