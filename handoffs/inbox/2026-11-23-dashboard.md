# Task: tandem local dashboard

- **From → To:** Claude → Gemini
- **Mode:** may edit (only the two files below)
- **Model hint:** orchestrator

## Goal
A local web dashboard for the `tandem` CLI showing how Claude and Gemini work together: who called whom, tokens, time, cost, Claude usage offloaded to Gemini, and budget status. Zero dependencies, works offline.

## Context
- Node >= 18.17, ESM, zero npm dependencies. Read `src/ledger.js` (`readRecords`, `summarize`) and `src/cli.js` (how `startDashboard(port, cfg, flags)` is called) first.
- Ledger record shape (one per call): `{v, id, ts, from, to, model, category, tag, project, promptChars, status, durationMs, turns, usage:{input,output,thinking,cacheRead,cacheWrite,total}, costUsd, claudeEquivUsd, sessionId, denied:[], error}`. `from` is "user" | "claude" | "gemini"; `to` is "claude" | "gemini"; `status` is "ok" | "error" | "quota" | "auth" | "timeout" | "denied" | "missing". `tag` "bench" marks benchmark runs.
- `summarize(records, cfg)` returns `{generatedAt, totals:{calls, claude:{calls,ok,failed,tokens,costUsd,claudeEquivUsd,durationMs}, gemini:{...}}, byModel:{[model]:bucket}, byDay:{[YYYY-MM-DD]:bucket}, byCategory, edges:{"user->gemini":bucket,...}, savings:{baseline, offloadedWeekUsd, offloadedAllUsd, claudeWeekUsd, offloadShareWeek, geminiMonthlyUsd, subscriptionsMonthlyUsd}, budget:{warnAt, claudeWeek:{used,cap,ratio}, gemini5h:{used,cap,ratio}, geminiWeek:{used,cap,ratio}, geminiQuotaHitAt, geminiLikelyLimited}, recent:[last 50 records, newest first]}`. Any `cap`/`ratio` may be null (no budget set).

## In scope
- Create `src/dashboard/server.js`: `export async function startDashboard(port, cfg, flags)`. Use `node:http`, bind to **127.0.0.1 only**. Routes: `GET /` serves `index.html` (read from the same directory via `import.meta.url`); `GET /api/summary` returns `summarize(records, cfg)` as JSON, where `?exclude=bench` drops records with `tag === 'bench'`; anything else → 404. Print the URL. If `flags.open`, open the browser (`start ""` on win32 via cmd, `open` on darwin, `xdg-open` elsewhere; use `child_process.spawn`, detached, ignore errors). If the port is busy, try the next 10 ports. Keep the process alive until Ctrl+C.
- Create `src/dashboard/index.html`: single self-contained file, inline CSS + vanilla JS, no CDN, no frameworks. Fetch `/api/summary` on load and every 5 s. Sections:
  1. Header: title "tandem", last-updated time, checkbox "hide benchmark runs" (toggles `?exclude=bench`, default checked).
  2. KPI tiles: total calls; Claude usage offloaded this week (`savings.offloadedWeekUsd`, label "Claude-equivalent, est."); Claude spent this week (`claudeWeekUsd`); Gemini share of work (`offloadShareWeek` as %).
  3. Budget: three horizontal meters (Claude 7d USD, Gemini 5h calls, Gemini 7d calls). Green < warnAt, amber ≥ warnAt, red ≥ 1. When cap is null show "no budget set — `tandem budget set …`". Show a red banner when `geminiLikelyLimited`.
  4. Flow diagram (inline SVG): three nodes User, Claude, Gemini; an arrow for every key in `edges`, labelled with call count and tokens. Arrow thickness scales with calls.
  5. Daily chart (inline SVG bars, last 14 days from `byDay`): calls per day.
  6. By model table: model, calls, ok %, tokens, avg time, Claude-equivalent $.
  7. Recent calls timeline (`recent`): time, `from → to`, model, status pill (colour by status), duration, tokens, and "saved ≈$x" for gemini rows / "cost ≈$x" for claude rows; show `error` on hover for failed rows.
- Styling: clean, readable, system font, CSS variables, works in light and dark (`prefers-color-scheme`), responsive down to 380 px wide, no horizontal scroll. Empty state when there are no calls yet.
- Format money like `$0.0123` under $1, `$1.23` above. Tokens as `12.3k`.

## Do NOT touch
- Any other file. Do not add dependencies or a package-lock. Do not run shell commands.

## Verify by
- I will run `node bin/tandem.js dashboard` and open it in a browser.

## Return format
Short summary (<150 words) of what you built and any assumptions.
