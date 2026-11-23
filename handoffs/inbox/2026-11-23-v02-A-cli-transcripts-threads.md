# Task A: prefer / pin / models / show commands, transcript reader, MCP threads

- **From → To:** Claude (lead) → Gemini · may edit ONLY: `src/cli.js`, `src/mcp.js`, new `src/transcripts.js` · model: orchestrator
- Plan: `docs/plans/v0.2-team.md` (sections B, C). Contracts are already in place (last commit): read `src/router.js` (`route(task, budget, {lead, pins})`, `parsePin`, `RULES`), `src/ledger.js` (`makeRecord` meta accepts `thread`, `lead`; records have `transcriptPath`, `sessionId`), `src/agents.js` (`transcriptPathFor`), `src/config.js` (`defaults.{claudeModel,geminiModel}`, `routing.pins`, `GEMINI_ALIASES`, `CLAUDE_ALIASES`, `setConfigValue`).
- Node ≥18.17, ESM, zero dependencies, cross-platform (`path.join`). Match the existing style (terse, small helpers, `c.*` colours from `src/format.js`). No shell commands.

## 1. `src/cli.js`: new commands (+ HELP lines)
- `tandem prefer` prints the current default models. `tandem prefer <claude|gemini> <model>` sets `defaults.claudeModel` / `defaults.geminiModel`. Accept an alias from the alias maps, or for gemini any slug matching `/^[a-z0-9.-]+$/`; otherwise throw with the list of aliases.
- `tandem pin` lists pins. `tandem pin <category> <agent:model>` sets `routing.pins.<category>` (validate category ∈ `RULES[].category` ∪ {`trivial`,`general`}; validate with `parsePin`). `tandem pin <category> --clear` removes it (write the whole `routing.pins` object back, since `setConfigValue` sets scalars; add a small helper using `readUserConfig`/`saveUserConfig`).
- `tandem models`: table of aliases → real slugs for both agents, marking the current defaults (★) and showing pins. `--live` also prints `agy models` output.
- `tandem show [last|<ledger id>|thread:<id>] [--max 4000] [--json]`: renders an exchange from the native transcript (via `src/transcripts.js`). For a thread, show all records with that `thread` in time order. Header per record: time, `from → to`, model, status, tokens, and the resume command. Then messages as `› user` / `‹ assistant` / `· tool` blocks, each text truncated to `--max` chars. If the transcript is missing, say so and still print the resume command.
- Add a `--thread <id>` flag to `ask`, `run` and `review`, passed as `thread` in the `callAndLog` meta. `route`/`run` already pass `lead`; also pass `lead: flags.lead` in the meta for `ask`/`run`.

## 2. New `src/transcripts.js`
`export function readTranscript(record, {maxChars = 4000} = {})` → `{agent, sessionId, path, found, messages: [{role: 'user'|'assistant'|'tool', text, model?, at?}], resume}`:
- `resume`: claude → `claude --resume <sessionId>`; gemini → `agy --conversation <sessionId>`.
- Path: `record.transcriptPath` or `transcriptPathFor(record.to, record.sessionId)`. For gemini, if `transcript.jsonl` lacks content, fall back to `transcript_full.jsonl` in the same folder.
- Claude Code JSONL: lines `{type:'user', message:{content: string | blocks[]}}` and `{type:'assistant', message:{model, content: blocks[]}}`. Blocks: `text`, `tool_use` (name + short JSON input), `tool_result` (content string or blocks), `thinking` (skip). Merge consecutive assistant lines that share `message.id`. Skip other line types.
- Antigravity JSONL (verified field names): `type, source, content, tool_calls, status, step_index, model, created_at, input_tokens, output_tokens, cache_read_tokens, thinking`. Inspect a real file to map `source`/`type` → role: `C:\Users\gunka\.gemini\antigravity-cli\brain\076e91ef-48d0-4154-abea-3a63ad4af55e\.system_generated\logs\transcript.jsonl`. Skip `thinking`. Show tool calls compactly.
- Never throw on malformed lines. Export the per-format parsers (`parseClaudeTranscript(lines)`, `parseGeminiTranscript(lines)`) for unit tests.

## 3. `src/mcp.js`: threads
- `ask_gemini` and `ask_claude` get an optional `thread` string param. Default: one id per server process (`mcp-<8 random hex>`, created in `serve`).
- Persist `~/.tandem/threads.json`: `{ [thread]: { claude: <session_id>, gemini: <conversation_id>, updatedAt } }`. On `ask_claude` with a known thread, pass `resume` (cache-warm, cheaper). On `ask_gemini`, pass `conversation` unless the caller set `conversation_id`. Store ids after each successful call.
- Pass `thread` and the existing `lead` in the `callAndLog` meta.
- Tool descriptions: say `orchestrator` is *a Gemini model (Neon plans, Hydrogen executes)*, not the team lead. In `ask_claude`, ask callers to send diffs/summaries, not file dumps, and to batch questions.

## Do NOT touch
Any other file (router, ledger, agents, hooks, init, dashboard, templates, tests). No new dependencies.

## Verify by
I'll run `npm test`, `tandem prefer`, `tandem pin review claude:opus`, `tandem models`, `tandem show last`, and an MCP thread round-trip.

## Return format
≤150 words: what you built, any assumptions about the Antigravity transcript format.

## Tooling note
Shell commands are denied in this headless run. Use only your file read / file edit tools (list files by reading known paths). Do not stop on a denied action: continue with file tools.
