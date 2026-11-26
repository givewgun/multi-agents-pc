# Changelog

All notable changes to `tandem-agents` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Docs
- `docs/DAILY.md`: "Follow-ups and memory (threads)" — what fresh-by-default means day to day and what to say to keep or drop a thread.

## [0.5.0] - 2026-11-26

**Upgrading:** `npm i -g tandem-agents@latest`, then restart Claude Code and Antigravity so the MCP server reloads. To keep a partner conversation across calls, pass the same `thread` (the `/gemini` and `/pair` skills already do).

### Added
- MCP response footer shows reused context size and cache percentage (e.g. `resumed: 122k input · 92% cached`; input summed over the call's agent steps) when resuming a partner session, and `fresh session` when unthreaded.

### Changed
- MCP `ask_gemini` / `ask_claude` calls without an explicit `thread` now start a fresh partner session instead of sharing a per-server default thread (no `threads.json` read/write, ledger `thread` is `null`, unthreaded calls can run in parallel).

## [0.4.0] - 2026-11-23

**Upgrading:** run `tandem init --global --force` once, then restart Claude Code and Antigravity. This installs the per-prompt hooks and the `/tandem` skill, and updates the skills and rules to opt-in delegation. It overwrites tandem's own skill/rule files, so re-apply any local edits you made to them.

### Added
- `tandem mode [ask|free|solo] [--for 5h]`, shared by both apps, and a `/tandem` skill to switch it from inside Claude Code or Antigravity.
  - `free`: every prompt counts as "use tandem freely". A Claude `UserPromptSubmit` hook adds a note to each prompt; an Antigravity `PreInvocation` hook adds a system message when the mode changes. Partners spawned by tandem never see it, so they can't delegate back.
  - `solo`: blocks MCP `ask_gemini`/`ask_claude`, CLI `ask`/`run`/`review` and `bench --agentic` team setups. `tandem solo on|off` is shorthand.
  - Shown in `tandem stats`, `tandem_stats` and the dashboard. Re-run `tandem init --global` to install the hooks and skill.

### Changed
- Delegation is opt-in. Skills and rules on both sides trigger only when the user asks (`/gemini`, `/pair`, "ask gemini/claude", "work with …") or says "use tandem freely" (the lead then decomposes and delegates by its own judgment for that task). Re-run `tandem init --global --force` to update installed skills.
- Routing: the lead classifies. `route_task`, `ask_gemini`, `ask_claude` take a `category` (MCP enum); CLI `route`/`run`/`ask` take `--category`. The lead has read the task, tandem's regex has not; tandem keeps pins, budgets, no-self-review and `self: true`.
- No keyword match now routes to `general` → Gemini Neon (was `trivial` → Flash Low for any prompt under 160 chars). Short is not easy: "mod a Skyrim Papyrus script" went to the weakest model.
- Picks report `source` (`lead`/`rules`) and `needsJudgment` (no match, tie, or mixed intent; mixed intent adds a "split into subtasks" note).
- Skills and AGENTS rules tell the lead to decompose and classify before routing.

### Fixed
- MCP `ask_*` without `model` now routes with the lead, so partner-only categories (review) pick the right model.
- Mode safety: the `/tandem` skill can't be invoked by Claude on its own (`disable-model-invocation`), partner runs (`TANDEM_MANAGED`) can't change the mode, and `--for` rejects `0`, empty, invalid or >1 year values instead of silently meaning "forever".
- `installClaudeHook` rewrites a stale tandem hook even when a current one follows it.
- Tests seed a usage snapshot, so they never spawn the real `agy /usage` (flaky timeouts, ~3s suite).

## [0.3.0] - 2026-11-23

### Added
- `allowCommands` config (opt-in): headless agents may run the listed test commands on `--edit` calls, e.g. `tandem config set allowCommands "npm test;node --test"`. User-set only, never from calling agents; shells, bare runners, inline-eval flags and separators are rejected. Denials now show how to enable it (CLI, MCP footer, `tandem doctor`).
- `tandem bench --team`: solo vs. scripted hand-off strategies on 5 hard hidden-test tasks; separates timeouts from wrong answers and reviewer real fixes from churn.
- `tandem bench --agentic`: a lead agent works in a temp project, may delegate via tandem MCP, graded by hidden tests; partner calls and cost come from the ledger.
- Claude bridge: `allow` / `disallow` tool rules and an isolated MCP config (`--strict-mcp-config`).

### Fixed
- Gemini headless note now lists per-call command grants (it said all shell commands were blocked, so Gemini never ran granted tests).
- Per-call Gemini permissions extend the user's agy allow/ask/deny rules instead of replacing them.
- Bench grading: nested `node --test` runs no longer inherit `NODE_TEST_CONTEXT` (which made every child exit 0).

## [0.2.1] - 2026-11-23

### Changed
- First automated npm Trusted Publishing (OIDC) release with provenance attestation and GitHub Release artifacts.

## [0.2.0] - 2026-11-23

### Added
- **Symmetric lead/partner team protocol:** either Claude Code or Antigravity (Gemini) can lead; `review` and `second-opinion` always route to the partner (never self-review).
- **Antigravity plugin (`tandem init --global`):** installs `~/.gemini/config/plugins/tandem/` with `ask_claude` MCP server, Stop hook, team rules, and `/ask-claude` + `/pair` skills (auto-migrates v0.1 loose files).
- **Claude Code `/pair` skill** alongside `/gemini`.
- **Native transcripts & threads:** `tandem show [last|<id>|thread:<id>]` renders exchanges directly from Claude/Antigravity transcripts with resume commands; MCP `thread` parameter reuses partner sessions per workspace.
- **Stop hooks (`tandem hook claude|gemini`):** reconciles direct interactive sessions into the ledger (with `TANDEM_MANAGED` and cross-agent guards to prevent double counting).
- **User model overrides:** `tandem prefer`, `tandem pin`, and `tandem models [--live]`.
- **Dashboard Conversations & Work Split:** inspect native transcripts, filter threads, and see interactive vs. delegated work split.
- **Plan-window budgets (`tandem usage`, `tandem budget`):** tracks 5-hour and weekly rolling plan windows via free `agy /usage` and Claude's `rate_limit_event`.
- **CLI polish:** `tandem --version` / `-v`, dynamic MCP `serverInfo.version`, and per-call `--add-dir` / `--allow` grants.
- **Docs & release automation:** `docs/ELI5.md`, Mermaid architecture diagrams, `SECURITY.md`, `docs/RELEASING.md`, and GitHub Actions automated release/npm publishing workflow.

### Fixed
- MCP `ask_claude` / `ask_gemini` now accept an explicit `cwd` parameter (and automatically query MCP `roots/list` when the client supports it), fixing plugin MCP servers spawning Claude inside `~/.gemini/config/plugins/tandem` instead of the active workspace.
- Headless `agy` empty-answer retry when a single action is denied.
- Dashboard `Host` and `Origin` header validation to guard against DNS rebinding.
- `--port 0` handling in `tandem dashboard`.
- Infer CLI caller from Claude Code environment (`CLAUDECODE` / `CLAUDE_CODE_ENTRYPOINT`) and guard cross-agent Stop hooks.
- Executable permission bit (`100755`) on `bin/tandem.js`.

## [0.1.0] - 2026-11-23

### Added
- Initial release: headless CLI bridges (`ask`, `route`, `run`, `review`), zero-token rule router, local JSONL ledger & savings estimates, MCP stdio server (`--expose gemini|claude|both`), local web dashboard, `tandem doctor`, `tandem init`, and `tandem bench`.
