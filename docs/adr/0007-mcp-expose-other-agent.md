# 0007. MCP server exposes only the other agent

- **Date:** 2026-11-23
- **Status:** accepted

## Context

Agents should be able to call each other natively as tools. However, exposing an agent to a tool that invokes itself risks self-recursion and runaway quota burn. Additionally, Antigravity spawns global plugin MCP servers with `cwd` set to the plugin folder rather than the active workspace.

## Decision

- Implement a hand-rolled stdio MCP server (`src/mcp.js`, newline-delimited JSON-RPC 2.0 supporting `initialize`, `ping`, `tools/list`, and `tools/call`, echoing supported protocol versions).
- Expose only the *partner* tool on each side: `--expose gemini` for Claude Code (`ask_gemini`) and `--expose claude` for Antigravity (`ask_claude`). Always expose `route_task` and `tandem_stats`.
- Accept an explicit `cwd` argument on `ask_claude`/`ask_gemini` (with automatic MCP `roots/list` fallback when the client advertises `capabilities.roots`) so partner agents run in the real workspace and scope saved threads per repo.
- Log calls with `from` set to the calling agent and `tag: mcp`.

## Consequences

**Pros**
- Zero SDK dependency, no self-call loops, and clear caller → callee edges in the dashboard.

**Trade-offs**
- We maintain protocol compatibility ourselves (covered by `test/mcp.test.js`).
