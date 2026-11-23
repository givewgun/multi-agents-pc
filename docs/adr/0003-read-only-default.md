# 0003. Read-only by default

Date: 2026-11-23 · Status: accepted

**Context:** A delegated agent runs unattended. Verified: agy headless with no `--mode` soft-denies edits and commands. `--mode plan` is NOT read-only (it writes a plan). `claude -p` default mode denies edits and Bash.
**Decision:** No mode flag unless `--edit` (agy `accept-edits`, claude `acceptEdits`). Shell commands are never auto-granted by tandem. `tandem review` runs `git diff` itself and puts the diff in the prompt. Denials surface as `status: denied` and `denied[]`.
**Consequences:** + safe default, reviews work without permission setup. − Agents can't run tests headless unless the user adds allow-rules (doctor hints at this).
