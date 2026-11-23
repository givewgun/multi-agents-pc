# 0008. Local static dashboard

Date: 2026-11-23 · Status: accepted

**Context:** Need a visual of flow, savings and budgets without dependencies, accounts, or exposing ledger data.
**Decision:** `node:http` bound to 127.0.0.1 (next 10 ports on conflict). It serves one self-contained `index.html` (inline CSS/JS/SVG, light+dark) and `GET /api/summary[?exclude=bench]`, polled every 5s. Built by Gemini Orchestrator from a handoff spec, then reviewed by Claude.
**Consequences:** + zero deps, offline, private. − No auth: anyone on the machine can read it (same as the ledger file). The HTML is large (~40KB), so agents should edit it surgically, not reload it whole.
