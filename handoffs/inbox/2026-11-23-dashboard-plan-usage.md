# Task: dashboard budget section → plan-window usage

- **From → To:** Claude → Gemini
- **Mode:** may edit `src/dashboard/index.html` only
- **Model hint:** hydrogen

## Goal
The Budget section of `src/dashboard/index.html` must show subscription plan windows (5-hour + weekly) for Claude and Gemini instead of the old USD/call-count budgets.

## Context
`GET /api/summary` → `budget` now has this shape (old `claudeWeek`, `gemini5h`, `geminiWeek`, `geminiLikelyLimited` fields are GONE):
```json
{
  "warnAt": 0.7,
  "geminiQuotaHitAt": null,
  "claude": {
    "known": true, "at": "2026-11-23T05:20:00Z", "ageMs": 12000, "source": "claude rate_limit_event", "status": "allowed",
    "fiveHour": { "used": 0.53, "resetsAt": "2026-11-23T08:00:00Z" },
    "weekly":   { "used": 0.10, "resetsAt": "2026-11-28T02:00:00Z" },
    "limits": { "fiveHour": 0.8, "weekly": 0.85 },
    "exhausted": false, "warn": false
  },
  "gemini": { "...same shape...": true,
    "other": [ { "name": "Gemini 4 Argon", "windows": [ { "window": "weekly", "used": 0, "resetsAt": "..." } ] } ] }
}
```
- `known: false` → no reading yet (then `fiveHour`/`weekly` are null). For Claude show "Unknown until tandem makes a Claude call — or run `tandem usage --refresh-claude`". For Gemini show "Unknown — is agy installed?".
- `used` and `limits.*` are fractions 0–1 of the plan window.
- Also new in the summary: `activity: { fiveHour: {claude: n, gemini: n}, week: {claude: n, gemini: n} }` (call counts).

## In scope
In `src/dashboard/index.html` only:
1. Replace the three budget meters with a 2×2 grid: rows Claude / Gemini, columns "5-hour window" / "Weekly window". Each cell: a horizontal meter whose fill = `used` (0–100% of the plan window), a thin vertical marker line at `limits.<window>` labelled "tandem limit 80%", text "53% used · resets in 2h 46m" (compute from `resetsAt`, show "reset" if past). Color: green below `warnAt × limit`, amber from there to the limit, red at/over the limit.
2. Under each agent row, small muted text: "from <source>, <age> ago" and the 5h/week call counts from `activity`. For Gemini, list `other` pools with non-zero `used` (e.g. "Gemini 4 Argon weekly 12%").
3. Banner (red) when `claude.exhausted` → "Claude at tandem's limit — Claude work is being routed to Gemini". Same for `gemini.exhausted` → "…routed to Claude" (mention `geminiQuotaHitAt` if set).
4. Section title "Plan usage", subtitle "Both plans meter a rolling 5-hour and weekly window. Limits: `tandem budget set claude-5h 80%`".
5. Remove all code that reads the old budget fields. Keep everything else (KPIs, flow, charts, tables, timeline, toggle, polling, theming, responsive ≤380px) unchanged.

## Do NOT touch
Any file other than `src/dashboard/index.html`. No external resources. No shell commands.

## Verify by
I run `tandem dashboard` and check both known and unknown states.

## Return format
<80 words: what changed.
