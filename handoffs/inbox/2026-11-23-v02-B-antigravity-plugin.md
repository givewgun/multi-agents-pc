# Task B: Antigravity plugin (your platform) + `init --global`

- **From → To:** Claude (lead) → Gemini · may edit ONLY: new `templates/antigravity-plugin/**`, `src/init.js` · model: neon-high (you know Antigravity best)
- Plan: `docs/plans/v0.2-team.md` (sections A, D and "Gemini critique: adopted changes"). Read `templates/AGENTS.md` (new role-neutral rules), `templates/skill-pair.md` (Claude's pair skill, which you mirror), `src/hooks.js` (`hookCommand(agent)`, `installClaudeHook()`, `runHook`), `src/init.js` (current `initGlobal`, `mcpCommand`, `mergeMcp`).
- Your built-in docs are readable: `C:\Users\gunka\.gemini\antigravity\builtin\skills\agy-customizations\` (`SKILL.md`, `docs/plugins.md`, `docs/hooks.md`, `docs/skills.md`, `docs/rules.md`, `docs/mcp_servers.md`). Follow them exactly for file names and formats. No shell commands.

## 1. `templates/antigravity-plugin/` (installed to `~/.gemini/config/plugins/tandem/`)
Exact layout per `docs/plugins.md`, including any required manifest. Contents:
- MCP config registering server `tandem` → `{{MCP_COMMAND}}` / `{{MCP_ARGS}}` placeholders (init fills them with `mcpCommand('claude')`: `ask_claude`, `route_task`, `tandem_stats`).
- `hooks.json`: `Stop` → command `{{HOOK_COMMAND}}` (init fills it with `hookCommand('gemini')`; it reads the hook JSON from stdin, logs, and prints nothing). Check `docs/hooks.md` for the required stdout/exit-code contract of a Stop hook and the timeout; tell me in your answer if the command must print something.
- Rule (always-on or model_decision, ≤12 lines): Gemini's version of the lead/partner contract. You lead when the user talks to you; Claude is the partner for architecture, hard bugs and final review, and is required for reviews and second opinions; keep Claude calls few and small, send diffs not dumps, batch questions, Sonnet by default and Opus only when genuinely hard; the user's named model always wins.
- Skills, native format: `ask-claude` (when and how to call `ask_claude`, brief template, pass `thread`, verify the answer) and `pair` (mirror `templates/skill-pair.md` with Gemini as lead: plan-critique, split, dual-review, second-opinion, handoff-lead → suggest continuing in Claude Code when deep judgment work dominates). Keep each ≤40 lines; descriptions must trigger on "work with claude", "ask claude", "pair", "second opinion", "review".

## 2. `src/init.js`: `initGlobal(flags)`
- Install the plugin: copy `templates/antigravity-plugin/**` to `~/.gemini/config/plugins/tandem/`, substituting placeholders (JSON-escape values). Overwrite only with `--force`, or when the existing plugin is tandem's (any marker you choose).
- Migrate v0.1: remove `~/.gemini/config/rules/claude-bridge.md` only if its content mentions `tandem`, and remove the `tandem` entry from `~/.gemini/config/mcp_config.json` (keep other servers; keep an empty file valid as `{}`), so nothing loads twice.
- Claude side: copy `templates/skill-gemini.md` → `~/.claude/skills/gemini/SKILL.md` and `templates/skill-pair.md` → `~/.claude/skills/pair/SKILL.md`; call `installClaudeHook()` from `./hooks.js` and print its result; keep the existing `claude mcp add --scope user` logic.
- Print one line per action (`write`, `update`, `remove`, `skip`) like the current code. Never crash on a missing or empty file.

## Do NOT touch
Any other file. No dependencies.

## Verify by
I'll run `tandem init --global` on this machine and check the Antigravity app picks up the plugin.

## Return format
≤200 words: files created, the Stop-hook stdout contract (with doc citation), anything the user must do in the app (e.g. enable the plugin, grant `mcp(tandem/ask_claude)`).
