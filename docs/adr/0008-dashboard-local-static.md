# 0008. Local static dashboard

- **Date:** 2026-11-23
- **Status:** accepted

## Context

Users need visual feedback on call flow, work split, plan budgets, and agent conversations without introducing npm dependencies, cloud accounts, or exposing local ledger data to the network.

## Decision

- Serve the dashboard from `node:http` bound strictly to `127.0.0.1` (trying the next 10 ports on conflict) with `Host` and `Origin` header validation to guard against DNS rebinding (`src/dashboard/server.js`).
- Serve one self-contained `src/dashboard/index.html` (inline CSS/JS/SVG, dark/light themes) polling `/api/summary`, `/api/records`, `/api/threads`, and `/api/record/:id` every 5 seconds.
- Initial UI built by Gemini Orchestrator from a handoff spec, then reviewed by Claude.

## Consequences

**Pros**
- Zero dependencies, completely offline, and local-only.

**Trade-offs**
- No login auth: any local process on the machine can read it (same trust boundary as `~/.tandem/ledger.jsonl`).
- `index.html` is a large single file (~80 KB), so edits should be targeted rather than full-file rewrites.
