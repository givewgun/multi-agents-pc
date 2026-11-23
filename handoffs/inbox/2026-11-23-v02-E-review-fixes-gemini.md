# Task E: fix your review findings in mcp.js + transcripts.js

- **From → To:** Claude → Gemini · may edit ONLY `src/mcp.js`, `src/transcripts.js` · model: neon-high
- These are findings 9, 10 and 13 from your own review (thread `v02-review`). Claude is fixing the others in other files at the same time, so don't touch any other file.

1. **threads.json keyed by project:** key entries by `${normCwd}\u0000${thread}` where `normCwd = path.resolve(process.cwd())`, lower-cased on win32. Use a null-prototype object when reading, reject `__proto__`/`constructor`/`prototype` thread names (fall back to the default thread), and write atomically (write `threads.json.tmp`, then `renameSync`). Keep the existing behaviour: per-thread ordering queue, cwd check, fresh retry when a reused session fails.
2. **Live config + consistent defaults:** in `callToolNow`, reload `loadConfig()` (from `./config.js`) on each call instead of using the startup `cfg`. When `model` is omitted: `ask_gemini` → `route()` with pins; if the pick is gemini use its model, else `liveCfg.defaults.geminiModel`. `ask_claude` → `route()` with pins; if the pick is claude use its model, else `liveCfg.defaults.claudeModel`. `tandem_stats` calls `sweep(liveCfg)` from `./hooks.js` before summarizing. `route_task` uses the live config too.
3. **transcripts.js:** `stripUserRequestWrapper` must match greedily through the LAST `</USER_REQUEST>` (`[\s\S]*`).

Shell commands are denied; use file tools only. Return ≤60 words.
