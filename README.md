# multi-agents-pc

Claude Code + Google Gemini (Antigravity) working as one team on this PC.

- **Playbook / who does what:** [playbook/PLAYBOOK.md](playbook/PLAYBOOK.md)
- **Shared agent rules:** [AGENTS.md](AGENTS.md) (read by both)
- **Bridges:** `scripts/ask-gemini.ps1` (Claude → Gemini), `scripts/ask-claude.ps1` (Gemini → Claude)
- **Async handoffs:** `handoffs/inbox/` → `handoffs/done/`, template in `handoffs/TEMPLATE.md`
- **Reuse in another project:** `scripts/new-project.ps1 <path>`

## One-time setup

1. Install Antigravity CLI: `irm https://antigravity.google/cli/install.ps1 | iex`
2. Open a new terminal, run `agy`, sign in with your AI Pro Google account, trust this folder. Run `/usage` to confirm Pro quota.
3. Run `claude` in a terminal and `/login` (headless `claude -p` uses its own login, separate from the desktop app).
4. Test: `.\scripts\ask-gemini.ps1 -Prompt "Reply: bridge ok"` and `.\scripts\ask-claude.ps1 -Prompt "Reply: bridge ok" -Model haiku`
