# Task: research Antigravity facts for tandem v0.2

- **From → To:** Claude → Gemini · read-only · neon-high

## Context
tandem (read `docs/ARCHITECTURE.md`, `docs/adr/README.md`) bridges Claude Code and you (Antigravity). It calls you headless with `agy -p ... --output-format json` (no `--project`). The user can't see these conversations in the Antigravity app or IDE. We're designing v0.2 to make the collaboration symmetric (either agent can lead) and visible. You know your platform best; answer from evidence.

Sources you may read: your built-in docs under `C:\Users\gunka\.gemini\antigravity\builtin` (e.g. `skills/antigravity_guide/references/*.md`, `skills/*/SKILL.md`), your config under `C:\Users\gunka\.gemini\config`, and the live docs at https://antigravity.google (`llms.txt`, append `.md` to page URLs). Don't run shell commands.

## Questions (answer each, cite file path or URL; say "unknown" rather than guess)
1. **Visibility:** do conversations created by `agy -p` show up in the Antigravity 2.0 app or the IDE? Under which project? Can tandem make them visible (`--project <name>`, `--new-project`, other)? Can the user open or continue a headless conversation in the app by its conversation_id?
2. **Skills:** Antigravity skill format and locations (workspace and global), how they're triggered, and how they differ from rules (`.agents/rules`). Should tandem ship an Antigravity skill (e.g. `ask-claude`, `pair`) instead of, or in addition to, the current rule?
3. **Hooks:** which hook events exist (e.g. after a turn or conversation), their payload (conversation id, model, token usage?), and the config location. Goal: when the user works with Gemini directly in Antigravity, log that work into tandem's ledger, so the dashboard shows Gemini-led work and not just delegated calls.
4. **Effort/models:** the default thinking level for Gemini 4 Neon in the Antigravity app versus `agy` headless (the user sees "Extra High" in the app). What does `Orchestrator (Neon)` actually do, and how does it relate to `--effort`?
5. **MCP from Antigravity:** when the user is in the app, can Gemini call tandem's `ask_claude` MCP tool, given it's registered in `~/.gemini/config/mcp_config.json`? Does the app prompt for permission? Is there anything else needed?
6. Anything else in Antigravity that would make a two-agent team (Claude + Gemini, either one leading) work better: subagents, swarm, sidecars, plugins, the remote-agent flag, ACP?

## Return format
Markdown, ≤600 words, one section per question, each claim with a source.
