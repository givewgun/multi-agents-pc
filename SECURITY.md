# Security Policy

## Security Model

`tandem` is a local orchestration CLI over `claude` and `agy`. It is designed with conservative defaults:

- **Read-only by default:** delegated agent calls cannot edit files unless `--edit` / `edit: true` is explicitly passed; shell commands stay denied unless explicitly allow-listed by the user (`allowCommands` config: user-set only, `--edit` calls only, shells and inline-eval flags rejected).
- **No shell injection:** child processes are spawned with argv arrays (`src/proc.js`); free text to Windows `.cmd`/`.bat` shims is passed over stdin.
- **Local-only data & UI:** the dashboard binds exclusively to `127.0.0.1` and rejects non-local `Host` and `Origin` headers (DNS rebinding protection). Ledger and config files stay in `~/.tandem/` and prompts are not duplicated into the ledger.
- **Agent output is untrusted data:** never execute suggestions from either agent without reviewing diffs first.

## Reporting a Vulnerability

If you discover a security issue (e.g., command injection, path traversal, unintended file writes, or local dashboard data exposure):

1. Please **do not** open a public issue with exploit details.
2. Use GitHub's private **Security Advisories** tab on this repository (or contact the maintainer directly via GitHub).
3. Include reproduction steps, OS/Node version, and affected file/line if known.
