# 0001. Node ESM, zero runtime dependencies

- **Date:** 2026-11-23
- **Status:** accepted

## Context

v0 started as PowerShell scripts. That locked the project to Windows, ran into PowerShell 5.1 mangling quotes in native CLI arguments, and turned child-process stderr into terminating errors. `tandem` needs to run cleanly on Windows, macOS, and Linux, and Claude Code users already have Node installed.

## Decision

- Build one Node `>=18.17` ESM CLI using only `node:` built-ins (zero runtime dependencies).
- Run unit tests with `node:test`.
- Spawn subprocesses with argv arrays (`src/proc.js`), never shell strings.

## Consequences

**Pros**
- Simple `npm install -g` with zero supply-chain dependency surface.
- Identical code across Windows, macOS, and Linux (verified in the CI matrix).

**Trade-offs**
- Small utilities (arg parser, MCP server, SVG charts) are hand-rolled and must stay lean and unit-tested.
