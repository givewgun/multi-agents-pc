# Claude + Gemini Playbook

Two subscriptions, one team. Main rule: **Claude thinks, Gemini lifts.** Claude's limits are the scarce, expensive part. Gemini (Google AI Pro, 180 THB/mo) is cheap, refills every 5 hours up to a weekly cap. Push volume to Gemini. Keep judgment with Claude.

---

## 1. What you have

| Surface | What it is | Use it for |
|---|---|---|
| **Claude Code** (this app / `claude` CLI) | Claude Opus/Sonnet agent | Lead engineer: plans, hard bugs, precise edits, reviews |
| **Antigravity 2.0 app** | Gemini agent desktop app: parallel agents, subagents, browser, background tasks | Big parallel builds, UI work + browser testing, scheduled automations |
| **Antigravity IDE** | VS Code–style editor with Gemini built in | Hands-on coding with inline AI when *you* drive |
| **`agy` CLI** | Gemini agent in the terminal, has headless `agy -p` | How Claude calls Gemini (and scripts/automation) |
| **Gemini app** (gemini.google.com) | Chat, Deep Research, Canvas, image/video | Long research reports, quick questions, media |
| **NotebookLM** | Q&A over your uploaded docs | Studying course/MOOC material, PDFs, specs |

**Gemini models on AI Pro:** Gemini 4 Neon / Argon / Hydrogen, Orchestrator, Gemini 3.8 Flash. Run `agy models` to see exact slugs.
**Not on AI Pro:** Gemini 4 Carbon (Ultra only). Claude Sonnet/Opus 5.5 inside Antigravity are paid add-ons. **Don't pick Claude models inside Antigravity.** You already have Claude here. Claude 4.6 / GPT-OSS trials there are removed 30 Nov 2026.

Quota check: `/usage` inside `agy`. Gemini models share one 5h + weekly pool.

---

## 2. Who does what

| Task | Owner | How |
|---|---|---|
| Decide architecture, write a spec/plan | **Claude** | Claude Code, plan mode |
| Read & summarize a big codebase, logs, or docs dump | **Gemini** | `/gemini` from Claude, or `agy` |
| "What's the current version / best lib / API change for X?" | **Gemini** | Google Search–grounded. `agy -p` or Gemini app |
| Deep multi-source research report | **Gemini app → Deep Research** | then paste summary to Claude to decide |
| Boilerplate, CRUD, test scaffolds, migrations, renames across many files | **Gemini (Flash)** | `ask-gemini.ps1 -Edit` from a clean git state |
| Tricky bug (race, state, weird failure) | **Claude** | Claude Code; ask Gemini for a 2nd hypothesis if stuck |
| Small precise edit (1–3 files) | **Claude** | Cheaper than writing a handoff |
| UI build + click-through testing in a browser | **Gemini** | Antigravity app (browser agent, screenshots) |
| Code review before merge | **Both** | Gemini first pass (cheap), Claude final pass |
| Second opinion on a plan | **Gemini** | `/gemini` "critique this plan" |
| Recurring jobs (daily digest, PR check) | **Gemini** | Antigravity Automations (cron sidecars) — uses Gemini quota, not Claude |
| Study / learn from course material | **NotebookLM + Gemini** | Upload PDFs/slides, ask questions |
| Images, diagrams, slides, video | **Gemini app** | Image/video generation |
| Writing docs, READMEs, commit msgs | **Gemini Flash** draft → Claude edit if it matters | |

When unsure: **if it's mostly reading or typing, Gemini. If it's mostly deciding, Claude.**

---

## 3. Combo workflows

### A. Plan → Build → Review (default for features)
1. **Claude**: brainstorm + write plan in `handoffs/inbox/<date>-<feature>.md` (from `TEMPLATE.md`). Commit.
2. **Gemini**: build it. Claude runs `/gemini` with `-Edit -PromptFile ...`, or you open the task in Antigravity.
3. **Claude**: review `git diff`, run tests, fix the subtle stuff.
Why: Claude spends tokens on the plan and the review. Gemini spends on the typing.

### B. Scout → Strike (unknown codebase)
1. **Gemini** (huge context): "Map this repo: entry points, data flow, where X lives. <400 words."
2. **Claude** reads that map + only the files that matter, then acts.
Why: Claude never burns context reading 200 files.

### C. Research → Decide
1. **Gemini app Deep Research** or `agy -p` with search: "Compare A vs B vs C for <use case>, current as of today, cite sources."
2. **Claude**: "Given this report and our constraints, pick one and plan it."

### D. Dual review (important changes)
Both review the same diff independently. Where they agree → fix. Where they disagree → that's where the real bug usually is; look yourself.

### E. Stuck bug
Claude debugs systematically. After 2 failed attempts: `/gemini` "Here is the symptom, code, and what we tried. Give 3 alternative hypotheses." Fresh model, fresh angle.

### F. Parallel sprint
Antigravity app runs several Gemini agents on independent tasks (tests for module A, docs for B, refactor C). Claude reviews each result. Rule: one agent per set of files.

---

## 4. Cost rules

1. **Gemini first for volume.** Reading >10 files, generating >200 lines, or web lookups → Gemini.
2. **Flash before Pro.** Gemini 3.8 Flash for mechanical work. Pro-tier Gemini 4 only for reasoning.
3. **Sonnet before Opus** for Claude, unless the task is genuinely hard.
4. **Self-contained handoffs.** A vague handoff costs a retry on both sides. Use the template.
5. **Summaries, not dumps.** Ask Gemini for "<300 words" so Claude's context stays small.
6. **Gemini weekly cap is real.** If Gemini is locked out, do only small tasks with Claude and wait for the 5h refresh. Don't move big grunt work to Claude.
7. **Don't double-pay.** No Claude models inside Antigravity. No Gemini API key unless you need CI (that's billed separately).

---

## 5. Daily driving

- **Hard problem / you want to talk it through** → open Claude Code in this folder (or your project). Say "use gemini for the grunt work" and Claude delegates via `/gemini`.
- **Big build, UI, or many parallel tasks** → Antigravity app. When it needs a review, it can call `scripts/ask-claude.ps1`.
- **Quick question / research / study** → Gemini app or NotebookLM. Free of coding-agent quota pressure.

New project? Copy `AGENTS.md`, `CLAUDE.md`, `scripts/`, `handoffs/TEMPLATE.md`, `.claude/skills/gemini/`, `.agents/rules/` into it (or run `scripts/new-project.ps1 <path>`).

---

## 6. Cheatsheet

```powershell
# Claude -> Gemini (read-only)
.\scripts\ask-gemini.ps1 -Prompt "Summarize the auth flow in src/ in 10 bullets"
# Claude -> Gemini (may edit, cheap model)
.\scripts\ask-gemini.ps1 -PromptFile handoffs\inbox\2026-11-23-tests.md -Edit -Model <flash-slug>
# follow-up in same Gemini conversation
.\scripts\ask-gemini.ps1 -Prompt "Also cover edge cases" -Continue <conversation_id>

# Gemini -> Claude (review)
.\scripts\ask-claude.ps1 -Prompt "Review uncommitted diff for bugs. Findings only, file:line."
.\scripts\ask-claude.ps1 -PromptFile handoffs\inbox\task.md -Model opus

# Gemini quota
agy        # then /usage
agy models # list model slugs
```

Logs of every bridge call: `handoffs/log/` (gitignored).
