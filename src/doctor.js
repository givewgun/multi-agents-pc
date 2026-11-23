import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { run } from './proc.js';
import { findAgy, findClaude, askGemini, askClaude } from './agents.js';
import { tandemHome, configPath } from './config.js';
import { readRecords } from './ledger.js';
import { c } from './format.js';

const ok = (m) => console.log(`${c.green('✓')} ${m}`);
const bad = (m, fix) => console.log(`${c.red('✗')} ${m}${fix ? `\n    ${c.dim('fix:')} ${fix}` : ''}`);
const warn = (m, fix) => console.log(`${c.yellow('!')} ${m}${fix ? `\n    ${c.dim('tip:')} ${fix}` : ''}`);

const AGY_INSTALL = process.platform === 'win32'
  ? 'irm https://antigravity.google/cli/install.ps1 | iex'
  : 'see https://antigravity.google/docs/install';

export async function doctor(cfg, flags = {}) {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major > 18 || (major === 18 && minor >= 17)) ok(`node ${process.versions.node}`);
  else bad(`node ${process.versions.node} is too old`, 'install Node 18.17+');

  const checkBin = async (label, bin, missingFix) => {
    if (!bin) return void bad(`${label} not found`, missingFix);
    const v = await run(bin, ['--version'], { timeoutMs: 20_000 });
    if (v.code === 0 && !v.timedOut) ok(`${label} ${v.stdout.trim() || '(version unknown)'} at ${bin}`);
    else bad(`${label} at ${bin} failed to run (${v.timedOut ? 'timeout' : `exit ${v.code}`})`, (v.stderr || '').trim().slice(0, 200) || missingFix);
    return bin;
  };
  const agy = await checkBin('agy', findAgy(cfg), `${AGY_INSTALL}; then run \`agy\` once to sign in`);
  const claude = await checkBin('claude', findClaude(cfg), 'https://claude.com/claude-code');

  const agySettings = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'settings.json');
  if (existsSync(agySettings)) {
    try {
      const s = JSON.parse(readFileSync(agySettings, 'utf8'));
      const allow = s.permissions?.allow || [];
      if (allow.some((r) => r.startsWith('command(git diff'))) ok('agy can run read-only git in headless mode');
      else warn('agy headless cannot run git commands (tandem review still works: it sends the diff in the prompt)',
        `add "command(git diff)", "command(git log)", "command(git show)" to permissions.allow in ${agySettings}`);
      if ((s.trustedWorkspaces || []).some((w) => /\\windows\\system32$/i.test(w))) {
        warn('agy trusts C:\\Windows\\System32 (usually from a first run in an admin terminal)', `remove it from trustedWorkspaces in ${agySettings}`);
      }
    } catch { warn(`could not parse ${agySettings}`); }
  }

  if (flags.live) {
    console.log(c.dim('\nlive checks (2 tiny calls)…'));
    const liveCfg = { ...cfg, timeouts: { geminiMs: 120_000, claudeMs: 120_000 } };
    if (agy) {
      const r = await askGemini({ prompt: 'Reply with exactly: OK', model: 'flash-low' }, liveCfg);
      r.ok ? ok(`gemini answers (${r.durationMs} ms)`) : bad(`gemini call failed: ${r.status} ${r.error || ''}`, r.status === 'auth' ? 'run `agy` and sign in' : undefined);
    }
    if (claude) {
      const r = await askClaude({ prompt: 'Reply with exactly: OK', model: 'haiku', maxTurns: 1 }, liveCfg);
      r.ok ? ok(`claude answers (${r.durationMs} ms)`) : bad(`claude call failed: ${r.status} ${r.error || ''}`, r.status === 'auth' ? 'run `claude` in a terminal and /login' : undefined);
    }
  } else {
    console.log(c.dim('\n(run `tandem doctor --live` to also make two tiny test calls)'));
  }

  const n = readRecords().length;
  console.log(c.dim(`\nhome ${tandemHome()} · config ${existsSync(configPath()) ? configPath() : 'defaults'} · ledger ${n} calls`));
}
