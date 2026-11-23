# Changelog

All notable changes to `tandem-agents` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `tandem bench --team`: solo vs. scripted hand-off strategies on 5 hard hidden-test tasks; separates timeouts from wrong answers and reviewer real fixes from churn.
- `tandem bench --agentic`: a lead agent works in a temp project, may delegate via tandem MCP, graded by hidden tests; partner calls and cost come from the ledger.
- Claude bridge: `allow` / `disallow` tool rules and an isolated MCP config (`--strict-mcp-config`).

### Fixed
- Gemini headless note now lists per-call command grants (it said all shell commands were blocked, so Gemini never ran granted tests).
- Per-call Gemini permissions extend the user's agy allow/deny rules instead of replacing them.

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
