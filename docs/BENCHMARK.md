# Team vs. solo — 2026-11-23

Does pairing Claude and Gemini beat one agent? Two benches, one run per cell, Windows 11, agy 1.5.14, Claude Code 2.1.330.

## `tandem bench --team`: scripted hand-offs, 5 hard single-function tasks

Spec-heavy tasks (npm semver ranges, RFC 4180 CSV, 5-field cron, glob, booking calendar), 18-25 hidden test cases each. The script fixes who does what.

| strategy | how | score (excl. timeouts) | timeouts | avg time | Claude $ (5 tasks) |
|---|---|---|---|---|---|
| solo-claude | Sonnet alone | 100% | 0 | **16s** | $0.74 |
| solo-gemini | Flash alone | 100% | 0 | 3.0m | **$0** |
| gemini-pair | Flash drafts → Neon reviews | 100% | 1 | 3.1m | $0 |
| draft-review | Flash drafts → Sonnet reviews | 100% | 0 | 3.7m | $0.75 |
| plan-execute | Sonnet lists pitfalls → Flash implements | 100% | 1 | 2.9m | $0.63 |

Sonnet replied LGTM to 4 of 5 Flash drafts. Both failures were Flash calls hitting the 5-minute timeout, and every extra hand-off is one more call that can time out.

## `tandem bench --agentic`: lead agent in a real project, chooses whether to delegate

A temp project per run (5-14 files, a README or doc spec, visible tests), graded afterwards by hidden tests it never saw. Team leads can call their partner through tandem's MCP tool (`ask_gemini` / `ask_claude`). Headless Claude runs with an isolated MCP config: tandem only, or nothing for solo.

| setup | hidden tests | partner calls | avg time | Claude $ (3 tasks) |
|---|---|---|---|---|
| claude-solo | 20/20 | 0 | **23s** | $0.45 |
| claude-lead (may call Gemini) | 20/20 | 0 | 34s | $0.54 |
| gemini-solo | 20/20 | 0 | 2.1m | **$0** |
| gemini-lead (may call Claude) | 20/20 | 3 | 2.7m | $0.58 |

Tasks: billing library with 3 seeded bugs (the bug report names only 2), a token-bucket rate limiter feature, and a 14-module config loader with 2 precedence bugs. The gemini-lead row is the re-run after fixing two tandem bugs this bench found. First run: Gemini was told it couldn't run tests, scored 20/20 anyway, $0.67.

## What it says

1. **No quality gain from pairing at this size.** Every setup that ran without a timeout passed every hidden test. These tasks don't separate the setups; bigger, ambiguous, multi-day work might.
2. **Claude as lead never delegated.** On projects of up to 14 files, reading the files itself was cheaper than writing a hand-off. Having tandem's tool loaded still added ~$0.03 per run.
3. **Gemini as lead always asked Claude for a "final review",** at $0.18-0.25 each: 13+ turns of re-reading files, with test runs denied. That is more than Claude doing the whole task alone ($0.15).
4. **The cheap win is routing, not pairing.** gemini-solo matched every score for $0, at about 6× the wall time. Use Claude solo when latency matters.
5. **Reliability is a team cost.** Flash timed out on 2 of 24 calls; multi-step strategies multiply that risk.

Bugs found and fixed by this bench: the headless note told Gemini all shell commands were blocked even when granted; agy `--settings` replaced the user's allow/deny rules instead of extending them; nested `node --test` runs exited 0 because they inherited `NODE_TEST_CONTEXT`.

Raw results: `~/.tandem/bench/team-*.json`, `~/.tandem/bench/agentic-*.json`.

---

# Per-model benchmark — 2026-11-23

`tandem bench`: 8 graded tasks × 7 models, one run each, Windows 11, agy 1.5.14, Claude Code 2.1.330.
The bulk-read row for Gemini comes from a re-run after fixing a tandem bug: long prompts weren't reaching Gemini, so every Gemini model failed that task in the first run.
Router verdicts below were computed **before** the routing changes they prompted (bulk-read Hydrogen → Neon, trivial Flash → Flash Low).

## Per model

| model | pass | avg time | avg tokens | Claude $ | Claude-equiv $ |
|---|---|---|---|---|---|
| gemini:flash-low | 88% | 3.3s | 11.8k | flat | $0.1780 |
| gemini:flash | 100% | 23.9s | 15.4k | flat | $0.6164 |
| gemini:hydrogen | 88% | 8.4s | 14.8k | flat | $0.4232 |
| gemini:orchestrator | 100% | 1.1m | 19.1k | flat | $1.23 |
| gemini:neon | 100% | 15.6s | 13.2k | flat | $0.4081 |
| claude:haiku | 100% | 11.7s | 72.0k | $0.0611 | $0.0611 |
| claude:sonnet | 100% | 6.3s | 70.1k | $1.10 | $1.10 |

## Router check

| category | best | pass | router picks | pass | verdict |
|---|---|---|---|---|---|
| trivial | gemini:flash-low | 100% | gemini:flash-low | 100% | ok |
| boilerplate | gemini:flash-low | 100% | gemini:hydrogen | 100% | ok |
| review | gemini:flash-low | 100% | gemini:neon | 100% | ok |
| bulk-read | gemini:neon | 100% | gemini:neon | 100% | ok |
| hard-debug | gemini:flash-low | 100% | claude:sonnet | 100% | ok |
| feature | gemini:flash-low | 100% | gemini:orchestrator | 100% | ok |

## Per task

| task | gemini:flash-low | gemini:flash | gemini:hydrogen | gemini:orchestrator | gemini:neon | claude:haiku | claude:sonnet |
|---|---|---|---|---|---|---|---|
| trivial-regex | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| boilerplate-slugify | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| review-offbyone | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| bulkread-logs | ✗ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ |
| hard-concurrency | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| hard-lru-fix | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| feature-expr-eval | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| agentic-repo-read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
