# ADRs

Read the one-liner first. Open the file only if you're touching that area. New decision → copy `TEMPLATE.md`, next number, add a line here.

| # | Decision | Status |
|---|---|---|
| [0001](0001-node-zero-deps.md) | Node ESM, zero runtime deps, one CLI for all OSes | accepted |
| [0002](0002-headless-cli-transport.md) | Drive `agy -p` / `claude -p`, not model APIs: uses subscriptions, no API keys | accepted |
| [0003](0003-read-only-default.md) | Delegated calls read-only unless `--edit`; review sends the diff in the prompt instead of granting shell | accepted |
| [0004](0004-prompt-transport.md) | Claude prompt via stdin; Gemini via argv, or stream-json stdin when >24k chars (no temp files) | accepted |
| [0005](0005-rule-router-bench-validated.md) | Regex router (0 tokens), validated and tuned by `tandem bench` | accepted |
| [0006](0006-local-ledger-savings.md) | Local JSONL ledger; savings = Gemini tokens at Claude price (estimate); prompts never stored | accepted; budget part superseded by 0009 |
| [0007](0007-mcp-expose-other-agent.md) | Hand-rolled MCP server; each side sees only the other agent's tool | accepted |
| [0008](0008-dashboard-local-static.md) | Dashboard = 127.0.0.1 server + one static HTML file, polling | accepted |
| [0009](0009-plan-window-budgets.md) | Budgets = % of each plan's 5h/weekly window, read from `claude` rate_limit_event and free `agy /usage` | accepted |
| [0010](0010-lead-partner-protocol.md) | Lead = agent the user talks to; partner for review/second opinion; user pins > budget > rules | accepted |
| [0011](0011-native-transcripts-and-hooks.md) | Read native transcripts (no prompt copies); Stop hooks log direct work; `TANDEM_MANAGED` prevents double count | accepted |
| [0012](0012-lead-classifies.md) | Lead LLM classifies + decomposes (`category`); router = policy; no match → `general` Neon, not Flash Low | accepted |
| [0013](0013-opt-in-delegation-solo.md) | Delegation is opt-in ("use tandem freely" = full judgment); `tandem solo` hard-blocks all agent-to-agent calls | accepted |
