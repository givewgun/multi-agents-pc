# 0015. Explicit thread reuse only and visible reuse cost

- **Date:** 2026-11-26
- **Status:** accepted

## Context

Previously, MCP `ask_gemini` and `ask_claude` calls that omitted `thread` fell back to a per-server default thread (`mcp-<hex>`). That default thread saved and resumed one partner session (`agy --conversation` / `claude --resume`) across unrelated one-off calls in the same host session. Because headless CLIs replay their full stored transcript on every resumed turn, input tokens grew silently with every call — observed in the ledger: a Claude thread grew from 49k to 122k input tokens over 3 calls, and a Gemini thread grew from 80k to 217k total tokens in 2 calls — while the caller had no visibility into the replayed context size.

## Decision

- **Reuse only on explicit `thread`:** `src/mcp.js` (`explicitThread()`) reads/writes `threads.json` and queues calls (`inThreadOrder`) only when the caller passes a non-empty, safe `thread` id. Omitting `thread` starts a fresh partner session, logs `thread: null` in the ledger (so the dashboard stops grouping unrelated calls), and allows unthreaded calls to run in parallel. Explicit `conversation_id` / `session_id` still works with or without a thread.
- **Show reuse cost in the footer:** Print `thread <id>` only when an explicit thread is set (otherwise `fresh session`, keeping `session <id>`). When the final response came from a resumed session (not after a fresh retry), append `reuseNote()` (`resumed: <N>k input · <P>% cached`, input summed over every agent step of the call, so it is an upper bound on replayed history), accounting for per-agent token normalization (Claude `usage.input` includes `cacheRead`; Gemini `usage.input` excludes `cacheRead`).

## Consequences

**Pros**
- Unrelated one-off calls no longer snowball input tokens or collide in a shared transcript, and can run in parallel.
- Multi-call threads stay opt-in and their replayed context size and cache hit rate are visible on every resumed reply.

**Trade-offs**
- Follow-up calls that omit `thread` start fresh and forget earlier turns; pass a shared `thread` id for multi-call workflows (plan-critique, review rounds) or pass the footer's `session <id>` as `conversation_id` / `session_id` to continue.
- Possible later follow-up (not implemented): warn, cap, or summarize when a reused thread grows past a token threshold.
