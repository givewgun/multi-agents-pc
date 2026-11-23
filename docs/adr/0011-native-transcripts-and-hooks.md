# 0011. Visibility and accounting from native transcripts + Stop hooks

- **Date:** 2026-11-23
- **Status:** accepted

## Context

Users could not inspect what the two agents said to each other, and the dashboard showed ~99% "offloaded" because only `tandem`-initiated calls were logged while direct interactive sessions stayed invisible.

Both CLIs already write full local transcripts:
- **Claude Code:** `~/.claude/projects/<cwd-slug>/<session>.jsonl`
- **Antigravity CLI:** `~/.gemini/antigravity-cli/brain/<id>/.system_generated/logs/transcript.jsonl`

*(Verified: headless `agy` conversations never appear in the Antigravity desktop app, even with `--new-project`—the project appears in the sidebar, but its conversation list stays empty. `tandem`'s own view is the only place to read them.)*

## Decision

- **No prompt copies:** ledger records store `sessionId`, `transcriptPath`, `thread`, and `lead`. `tandem show` and the dashboard's **Conversations** tab read the native transcript files directly and print the native resume command (`claude --resume`, `agy --conversation`).
- **Stop hooks for direct work:** install Stop hooks (`~/.claude/settings.json` for Claude Code; `~/.gemini/config/plugins/tandem/hooks.json` for Antigravity) running `tandem hook <agent>`.
- **Reconcile + sweep:** hooks reconcile each session's transcript token totals against `~/.tandem/hook-state.json` (deduplicating Claude's streamed messages by `message.id`) and log the delta as `tag: interactive`. A periodic `sweep` picks up tokens written *after* Antigravity's Stop hook fires.
- **Prevent double counting:** `tandem` sets `TANDEM_MANAGED=1` on agents it spawns (and guards cross-agent CLI invocations); hooks skip those runs and swallow all errors so an agent session is never disrupted (measured: 122 ms on a 6 MB transcript).

## Consequences

**Pros**
- Honest interactive-vs-delegated work split, full conversation visibility without duplicating prompt data, and privacy model unchanged ([0006](0006-local-ledger-savings.md)).

**Trade-offs**
- Depends on undocumented native transcript schemas; parsers are written defensively and unit-tested.
- The very first hook run on an already-long session logs that session's accumulated history once.
