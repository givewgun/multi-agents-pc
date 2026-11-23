# Benchmark — 2026-11-23

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
