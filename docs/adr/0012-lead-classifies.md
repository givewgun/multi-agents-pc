# 0012. The lead classifies; the router applies policy

- **Date:** 2026-11-23
- **Status:** accepted *(plan critiqued by Gemini Neon)*

## Context

The regex router (0005) was the only thing deciding *what kind* of task it saw. Two gaps:
- "need to mod skyrim and modify papyrus script of enb" matches no rule and is under 160 chars, so it went to `trivial` → Flash Low. It is a niche, multi-part task: domain research, scripting, review. The prompt even mixes Papyrus (Skyrim's script language) with ENB (HLSL shaders + ini).
- When Claude Code or Antigravity leads, the lead is an LLM that has already read the task. A keyword matcher re-guessing its meaning throws that away. `tandem bench` grades category → model, never prompt → category.

An LLM classifier inside tandem costs tokens on every call (rejected in 0005). The lead's classification is free: it is part of reasoning it does anyway.

## Decision

- `route(task, budget, {lead, pins, category})`. A valid `category` (`CATEGORIES` = rule categories + `general`) skips the regex: `source: 'lead'`, `confidence: 1`. Unknown categories throw (MCP returns `isError`).
- Pins > budget > category/rules, no-self-review and `self: true` are unchanged: tandem is the policy layer, the lead is the classifier.
- MCP `route_task`, `ask_gemini`, `ask_claude` take `category` as an enum; CLI `route`/`run`/`ask` take `--category`. `ask_*` now route with `lead` too.
- No keyword match → `general` → Gemini Neon (not Flash Low). `trivial` needs a positive match. `needsJudgment: true` on no match, ties (confidence ≤ 0.5) or mixed intent (runner-up ≥ half the top score, plus a "split into subtasks" note).
- Skills and AGENTS rules: decompose first, classify each part, then route.

## Consequences

**Pros**
- Niche or multi-part prompts are classified by the agent that understands them, at 0 extra tokens. Regex stays for humans on the CLI and as a fallback.

**Trade-offs**
- Lead classification quality is not measured; `test/router-classify.test.js` only guards the regex fallback. `general` has no bench task (a fallback, exempt from 0005's per-rule bench rule).
- Unmatched short prompts now cost a Neon call instead of Flash Low: slower, still on the flat-rate plan.
