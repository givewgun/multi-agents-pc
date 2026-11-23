# 0014. Session delegation mode via per-prompt hooks

- **Date:** 2026-11-23
- **Status:** accepted *(hook facts researched by Gemini, checked against the local Antigravity docs)*

## Context

After 0013 the user had to type "use tandem freely" on every prompt to get judgment-based delegation. They want a switch like `/remote-control`: on for a session, off later, in both Claude Code and Antigravity. The mode must reach the model every turn without the user repeating it, and agents must not toggle it themselves.

Verified delivery channels:
- Claude Code `UserPromptSubmit` hook: `hookSpecificOutput.additionalContext` is added to that prompt.
- Antigravity `PreInvocation` hook: `injectSteps[].systemMessage` is added. It fires before *every* model call (also after tool steps), and the message persists in the conversation.
- MCP server `instructions` are cached to disk by Antigravity (not shown to the model), and its support for `tools/list_changed` is unknown, so MCP alone can't carry the mode.

## Decision

- One global mode in `~/.tandem/config.json`: `mode: {value: ask|free|solo, until}`; expired → ask. `solo` (0013) becomes a mode; `tandem solo on|off` stays as shorthand.
- `tandem mode <m> [--for 5h]` on the CLI; a `/tandem` skill in both apps runs it. The skill only fires on the user's `/tandem`; agents have no MCP tool to change the mode.
- Hooks (`tandem hook <agent> prompt`) inject `modeContext()`: Claude on every prompt while free/solo (cheap, survives compaction); Gemini only when the mode changes for that conversation (avoids one message per model call). A one-time reset note goes out when the mode returns to ask, so a stale "free" note can't linger. State per session in `~/.tandem/mode-state.json` (last 200).
- Hooks stay silent for tandem-spawned partners (`TANDEM_MANAGED`) and cross-agent CLI runs: a partner told "free" would delegate straight back.

## Consequences

**Pros**
- One switch, both apps, no repeated prompting; ask stays the zero-token default.

**Trade-offs**
- Global, not per-window: free mode applies to every open session of both apps until it ends (`--for` helps).
- Free mode is still a soft instruction: the lead decides what to delegate. Solo remains the only hard block.
- Needs `tandem init --global` to install the hooks and skill; sessions started before a mode change see it from their next prompt.
