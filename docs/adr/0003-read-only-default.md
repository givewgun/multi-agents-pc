# 0003. Read-only by default

- **Date:** 2026-11-23
- **Status:** accepted

## Context

Delegated agent calls run unattended. Verified behavior across both CLIs:
- Headless `agy` without `--mode` soft-denies edits and shell commands (`--mode plan` is *not* read-only; it writes a plan).
- `claude -p` in default mode denies edits and Bash.

## Decision

- Pass no edit mode flag unless `--edit` is explicitly given (`agy --mode accept-edits`, `claude --permission-mode acceptEdits`).
- Never auto-grant shell commands from `tandem`.
- For `tandem review`, run `git diff` inside `tandem` and embed the diff in the prompt so reviews require no shell permissions.
- Surface any blocked actions clearly as `status: denied` and `denied[]`.

## Consequences

**Pros**
- Safe default for unattended delegation; code reviews work out of the box without permission setup.

**Trade-offs**
- Headless agents cannot run test suites or shell commands unless the user explicitly adds allow-rules (hinted by `tandem doctor`).
