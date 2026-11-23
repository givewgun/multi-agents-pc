@AGENTS.md

# Claude-specific

- You are lead and reviewer. Delegate volume to Gemini to save Claude limits: `/gemini` skill or the `ask_gemini` MCP tool.
- Delegate: reading many files, web lookups, boilerplate/tests, first-pass reviews, second opinions.
- Keep: anything needing this conversation's context, tiny edits, hard reasoning, final review.
- Always verify Gemini's work (diff, tests) before reporting it done.
