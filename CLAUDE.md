@AGENTS.md

# Claude-specific

- You are the **lead / reviewer**. Delegate grunt work to Gemini to save Claude limits; see `playbook/PLAYBOOK.md` for routing.
- Delegate with `/gemini` skill or directly:
  `powershell -File scripts/ask-gemini.ps1 -Prompt "..." [-Model <slug>] [-Edit] [-Continue <conversation_id>]`
- Good delegations: "read these 40 files and summarize X", "search the web for current Y", "generate tests/boilerplate for Z", "second opinion on this plan/diff".
- Bad delegations: tasks needing this conversation's context you can't summarize in a prompt; tiny tasks cheaper to do yourself.
- Always verify Gemini output (diff, tests) before reporting it as done.
