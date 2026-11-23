# 0001. Node ESM, zero runtime dependencies

Date: 2026-11-23 · Status: accepted

**Context:** v0 was PowerShell scripts. That meant Windows only, PS 5.1 mangling quotes in native args, and stderr turning into terminating errors. The tool must also run on macOS/Linux, and Claude Code users already have Node.
**Decision:** One Node ≥18.17 ESM CLI using only `node:` built-ins. Tests use `node:test`. Spawn with argv arrays, never a shell string.
**Consequences:** + `npm i -g`, no supply-chain surface, same code on 3 OSes (CI matrix). − We hand-roll small things (arg parser, MCP server, SVG charts). Keep them small and tested.
