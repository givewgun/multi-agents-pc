# 0002. Drive headless agent CLIs, not model APIs

Date: 2026-11-23 · Status: accepted

**Context:** Users pay flat subscriptions (Claude plan, Google AI Pro). API keys bill separately and skip each agent's tools (file read, search, edits). Gemini CLI is gone. Antigravity's `agy` is the Gemini path.
**Decision:** Call `agy -p … --output-format json` and `claude -p --output-format json` as subprocesses, and normalize their output (ARCHITECTURE.md "Contracts").
**Consequences:** + uses existing subscriptions and full agent tooling, no secrets in tandem. − ~70k-token overhead per Claude call (measured), CLI output formats can drift. Mitigation: parsers tolerate noise lines, `tandem doctor --live` catches breakage.
