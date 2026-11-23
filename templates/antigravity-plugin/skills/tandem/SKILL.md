---
name: tandem
description: Set tandem's delegation mode when the user types "/tandem" ("/tandem free", "/tandem ask", "/tandem solo --for 3h", "/tandem" for status). Only on the user's explicit /tandem command; never change the mode on your own.
---

# tandem mode

Run exactly `{{TANDEM_CMD}} mode <args>` with the user's arguments, and reply with its one-line output.

- Arguments: `ask`, `free` or `solo`, optional `--for 3h`. No arguments: show the current mode. Read `on` as `free` and `off` as `ask`.
- `free`: from the next prompt on, tandem injects a persistent system message when the mode changes (Claude gets a note every prompt): delegate by your own judgment, as if the user said "use tandem freely".
- `solo`: never call the other agent. `ask` (default): delegate only when the user asks.
- The mode is shared by Claude Code and Antigravity, and ends at `--for` or with `/tandem ask`.
