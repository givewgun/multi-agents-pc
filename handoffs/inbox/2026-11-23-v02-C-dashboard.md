# Task C: dashboard — Conversations tab + "work split"

- **From → To:** Claude (lead) → Gemini · may edit ONLY `src/dashboard/server.js`, `src/dashboard/index.html` · model: orchestrator
- Read first: `src/transcripts.js` (`readTranscript(record, {maxChars})` → `{agent, sessionId, path, found, messages[{role,text,model?,at?}], resume}`), `src/ledger.js` (`summarize` now returns `workSplit` and records have `thread`, `lead`, `tag`, `transcriptPath`), and the current dashboard files.

## server.js
- `GET /api/records?limit=200[&thread=<id>]` → newest-first ledger records (without `usage` details beyond `total`).
- `GET /api/record/<id>` → `{record, transcript: readTranscript(record, {maxChars: 6000})}`. 404 if unknown. Validate `id` against `/^[0-9a-f-]{36}$/`.
- `GET /api/threads` → `[{thread, records: n, agents: ['claude','gemini'], first, last, leads: [...]}]` for records with a `thread`, newest first.
- Keep 127.0.0.1-only, no new deps, all errors → JSON `{error}` with status.

## index.html
1. **Tabs:** "Overview" (everything that exists now) | "Conversations". Remember the tab in `location.hash`.
2. **Work split** (Overview, above the KPI tiles or replacing the "Gemini share" tile): from `summary.workSplit.{claude,gemini}.{interactive,delegated}` show a horizontal stacked bar per agent, plus totals: tokens and Claude-equivalent $. Legend: "direct with you" (interactive) vs "asked by the other agent / tandem" (delegated). Title "Who did the work (7 days)". Rename the "Claude usage offloaded" tile to "Delegated to Gemini (Claude-equiv, est.)".
3. **Conversations tab:** a left list of threads (`/api/threads`) and below it "Recent calls" (`/api/records?limit=50`). Selecting a thread or call shows the right pane: one card per record in time order (header: time, `from → to`, model, lead badge, status pill, tokens, a "copy" button for the `resume` command), then the transcript messages as chat bubbles (user/assistant/tool, with tool messages collapsed by default). Bubbles are coloured by agent (Claude orange, Gemini blue, the same colours the flow diagram uses). Long text is collapsible. `found: false` → "Transcript not found on this machine" + the resume command.
4. Responsive down to 380px (list above the pane on mobile), light/dark, no external resources, escape all transcript text (no innerHTML with raw content).

## Do NOT touch
Any other file. No dependencies. No shell commands.

## Return format
≤120 words.
