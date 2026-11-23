# 0004. Prompt transport

Date: 2026-11-23 · Status: accepted

**Context:** Windows caps a command line at 32,767 chars. npm `.cmd` shims need a shell, which breaks free-text argv. The first version wrote long prompts to `~/.tandem/prompts/` and asked agy to read them. Headless agy denies reads outside the workspace, so every Gemini model failed the 600-line bench task.
**Decision:** Claude gets the prompt on stdin, always. Gemini gets it as `-p` argv when ≤24k chars; above that, one NDJSON `user` event on stdin with `--input-format/--output-format stream-json` (no `-p`), and we parse the `result` event. `proc.run` refuses shell-unsafe argv to shims.
**Consequences:** + no length limit, no temp files, no shell injection surface. − Two Gemini parse paths (`lastJsonLine`, `streamResult`), both unit-tested.
