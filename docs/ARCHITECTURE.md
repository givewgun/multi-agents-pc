# Architecture

tandem = thin orchestration layer over two *headless agent CLIs*. It owns no model calls itself.

```
 user / Claude Code / Antigravity
        │ CLI (bin/tandem.js)      │ MCP stdio (tandem mcp)
        ▼                          ▼
   src/cli.js ── route() ── src/router.js        (rules, no tokens)
        │ callAndLog()
        ▼
   src/agents.js ── askGemini ─► agy  (-p argv | stream-json stdin)
                └── askClaude ─► claude -p (prompt on stdin)
        │ normalized result
        ▼
   src/ledger.js ─► ~/.tandem/ledger.jsonl ─► summarize() ─► stats / budget / router / dashboard
```

## Modules

| File | Role | Key exports |
|---|---|---|
| `bin/tandem.js` | entry, error → exit code | — |
| `src/cli.js` | arg parsing, commands, `callAndLog` (the one path every agent call takes) | `main`, `parseArgs`, `callAndLog` |
| `src/agents.js` | find binaries, build argv, parse output → **normalized result** | `askGemini`, `askClaude`, `ask`, `lastJsonLine`, `streamResult`, `classifyFailure` |
| `src/proc.js` | spawn without shell, timeout + tree kill, `.cmd` shim guard | `run`, `which` |
| `src/router.js` | weighted regex rules + budget overrides | `RULES`, `route` |
| `src/ledger.js` | record build, append/read JSONL, cost math, aggregates | `makeRecord`, `appendRecord`, `readRecords`, `summarize`, `claudeEquivalentUsd` |
| `src/config.js` | defaults ⊕ `~/.tandem/config.json`, aliases, pricing | `loadConfig`, `setConfigValue`, `resolve*Model` |
| `src/mcp.js` | MCP server, newline JSON-RPC 2.0, tools depend on `--expose` | `serve` |
| `src/init.js` | copy `templates/` into a project + MCP configs; `--global`: `~/.claude/skills`, `~/.gemini/config/{rules,mcp_config.json}`, `claude mcp add --scope user` | `init`, `initGlobal` |
| `src/doctor.js` | install/auth/permission checks, `--live` pings | `doctor` |
| `src/dashboard/` | `server.js` (127.0.0.1 http, `/api/summary`) + single-file `index.html` | `startDashboard` |
| `src/bench/` | graded tasks (`tasks.js`), runner + router check (`run.js`) | `TASKS`, `bench`, `analyze` |
| `templates/` | files `init` installs (AGENTS.md, CLAUDE.md, skill, agy rule, handoff) | — |

## Contracts (don't break)

- **Normalized result** (agents.js `result()`): `{agent, model, ok, status, text, sessionId, usage{input,output,thinking,cacheRead,cacheWrite,total}, costUsd, durationMs, turns, denied[], error, stderr}`. `status ∈ ok|error|quota|auth|timeout|denied|missing`.
- **Ledger record v1** (ledger.js `makeRecord`): append-only JSONL. Add fields, never rename. Bump `v` on breaking change.
- **Summary shape** (`summarize`): consumed by the dashboard, MCP `tandem_stats` and the router. Change all three together.
- **Router rule**: `{category, agent, model(alias), weight, re, reason}`. `category` names are shared with bench tasks.

## Agent CLI facts (verified 2026-11-23, agy 1.5.14, claude 2.1.330)

- `agy -p "<prompt>" --output-format json` → `{conversation_id,status,response,error,duration_seconds,num_turns,usage{input_tokens,output_tokens,thinking_tokens,cache_read_tokens,total_tokens},denied_actions[]}`.
- `agy --input-format stream-json --output-format stream-json` (no `-p`) reads `{"event":"user","message":{"content":...}}` from stdin, result in the `{"event":"result","result":{...}}` line.
- agy headless: no `--mode` = edits + commands soft-denied (exit 0, `denied_actions`). `--mode plan` is *not* read-only. `--mode accept-edits` = edits ok, commands still need `permissions.allow` in `~/.gemini/antigravity-cli/settings.json`. Reads outside workspace denied.
- agy MCP tools in headless need `mcp(<server>/<tool>)` in `permissions.allow`. Antigravity may create an empty `~/.gemini/config/mcp_config.json` (treat as `{}`).
- `claude -p` reads prompt from stdin. JSON: `{result,is_error,session_id,usage{input_tokens,cache_creation_input_tokens,cache_read_input_tokens,output_tokens},total_cost_usd,num_turns,duration_ms,permission_denials[]}`. ~70k tokens overhead per call.

## Extending

- New agent (e.g. Codex): add `askX` in agents.js returning the normalized result, a case in `ask()`, aliases in config.js, MCP tool in mcp.js. The ledger and dashboard work unchanged.
- New route category: add rule in router.js, add ≥1 bench task with the same `category`, run `tandem bench`, update README table.
- New command: add `cmdX` in cli.js + HELP line. Lazy-import heavy modules.

Decisions and their reasons: [adr/](adr/README.md).
