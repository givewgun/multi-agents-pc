# Shared rules — Claude Code + Gemini (Antigravity)

Both agents read this file. Claude Code via `CLAUDE.md` (imports this file); Antigravity `agy` reads `AGENTS.md` natively.

## Team

| Agent | Tool | Strength | Budget |
|---|---|---|---|
| **Claude** (Opus/Sonnet) | Claude Code | Planning, architecture, hard debugging, precise multi-file edits, final review | Claude plan limits — spend on thinking, not grunt work |
| **Gemini** (Gemini 4 / 3.8 Flash) | Antigravity app, `agy` CLI | Huge-context reading, Google Search research, bulk/boilerplate edits, browser testing, UI/image work, second opinions | Google AI Pro — 5h refresh + weekly cap |

## Handoff protocol

- One-shot calls: `scripts/ask-gemini.ps1` (Claude → Gemini) and `scripts/ask-claude.ps1` (Gemini → Claude).
- Async / larger work: write a task file to `handoffs/inbox/<date>-<slug>.md` using `handoffs/TEMPLATE.md`. Receiver writes result to `handoffs/done/` with same name.
- Every handoff states: goal, files in scope, what NOT to touch, how to verify, expected output format.
- Receiver never trusts the sender blindly: verify claims (run tests, read the diff) before building on them.

## Ground rules

- Never both edit the same file at the same time. One writer per file set.
- Use git. Commit before handing edit work to the other agent, so the diff is reviewable.
- Default delegated mode is **read-only**. Grant edits explicitly (`-Edit`).
- No secrets in prompts, handoff files, or logs. `handoffs/log/` is gitignored but still treat it as shareable.
- Cheap model first: Flash for bulk/mechanical, Pro/Opus only for hard reasoning.
