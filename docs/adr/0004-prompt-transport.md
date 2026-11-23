# 0004. Prompt transport

- **Date:** 2026-11-23
- **Status:** accepted

## Context

- Windows caps a command line at 32,767 characters, and npm `.cmd` shims require a shell, which breaks free-text argv.
- An earlier attempt wrote long prompts to `~/.tandem/prompts/` and asked `agy` to read them, but headless `agy` denies reads outside the active workspace—causing every Gemini model to fail the 600-line benchmark task.

## Decision

- **Claude:** always pass the prompt via stdin.
- **Gemini:** pass via `-p` argv when `<= 24k` chars (and not a `.cmd` shim); above that, send one NDJSON `user` event over stdin with `--input-format stream-json --output-format stream-json` (no `-p`) and parse the `result` event.
- **`src/proc.js`:** refuse to pass shell-unsafe argv strings to `.cmd`/`.bat` shims.

## Consequences

**Pros**
- No prompt length limit, no temp files, and no shell-injection surface.

**Trade-offs**
- Two Gemini output parsers (`lastJsonLine` and `streamResult`) to maintain; both are unit-tested.
