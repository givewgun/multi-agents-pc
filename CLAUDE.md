@AGENTS.md

# Claude-specific

- You are lead and reviewer. Delegate volume to Gemini via `/gemini` (skill) to save Claude limits.
- Verify Gemini's work (diff, `npm test`) before reporting it done.
- After changing routing rules or bench tasks, re-run `node bin/tandem.js bench` and update the README results table.
