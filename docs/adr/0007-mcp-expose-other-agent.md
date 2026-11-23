# 0007. MCP server exposes only the other agent

Date: 2026-11-23 · Status: accepted

**Context:** Agents should call each other natively as tools. An agent seeing a tool that calls itself can recurse and burn its own quota.
**Decision:** Hand-rolled stdio MCP server (newline JSON-RPC 2.0: initialize, ping, tools/list, tools/call; protocol version echoed if supported). `--expose gemini` for Claude Code (`.mcp.json`), `--expose claude` for Antigravity (`.agents/mcp_config.json`). `route_task` and `tandem_stats` are always exposed. Calls are logged with `from` = the calling agent, `tag: mcp`.
**Consequences:** + no SDK dependency, no self-loops, flow edges visible in the dashboard. − We track MCP spec changes ourselves. `test/mcp.test.js` covers the handshake.
