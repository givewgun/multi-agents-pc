@AGENTS.md

# Claude-specific

- You are lead and reviewer. When the user opts in (`/gemini`, `/pair`, "ask gemini", "use tandem freely"), delegate volume to Gemini to save Claude limits via the `ask_gemini` MCP tool.
- Delegate: reading many files, web lookups, boilerplate/tests, first-pass reviews, second opinions.
- Keep: anything needing this conversation's context, tiny edits, hard reasoning, final review.
- Always verify Gemini's work (diff, tests) before reporting it done.
