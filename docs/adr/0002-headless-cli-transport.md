# 0002. Drive headless agent CLIs, not model APIs

- **Date:** 2026-11-23
- **Status:** accepted

## Context

Users already pay for flat-rate subscriptions (Claude plan and Google AI Pro/Ultra). Calling raw model APIs bills separately and gives up each agent's built-in tooling (file reading, search, edits). The standalone Gemini CLI is gone; Antigravity's `agy` CLI is the headless Gemini interface.

## Decision

Invoke `agy -p … --output-format json` (or `stream-json`) and `claude -p --output-format stream-json --verbose` as subprocesses, and normalize both outputs into one shared result shape (see `docs/ARCHITECTURE.md` → *Contracts*).

## Consequences

**Pros**
- Uses existing subscriptions and full agent tooling with no API keys or secrets stored in `tandem`.

**Trade-offs**
- Every headless Claude Code call carries ~70k tokens of system/tool overhead (measured via `tandem bench`).
- Upstream CLI output formats can drift over time. Mitigated by noise-tolerant JSON parsers and `tandem doctor --live`.
