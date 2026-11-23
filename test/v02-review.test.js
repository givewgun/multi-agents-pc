// Regressions from Gemini's review of v0.2 (thread v02-review).
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-v02r-'));
process.env.TANDEM_HOME = tmp;
const { reconcile, sweep, hookCommand, installClaudeHook } = await import('../src/hooks.js');
const { appendRecord, readRecords, priceKey } = await import('../src/ledger.js');
const { route } = await import('../src/router.js');
const { DEFAULT_CONFIG, DEFAULT_PRICING } = await import('../src/config.js');
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const step = (i, o) => JSON.stringify({ type: 'PLANNER_RESPONSE', input_tokens: i, output_tokens: o, model: 'gemini-4-neon-medium' }) + '\n';
const interactive = () => readRecords().filter((r) => r.tag === 'interactive');

describe('v0.2 review fixes', () => {
  it('a resumed tandem session only logs tokens beyond what tandem already logged', () => {
    const t = path.join(tmp, 'resumed.jsonl');
    fs.writeFileSync(t, step(1000, 10));
    appendRecord({ v: 1, id: 'x', ts: new Date().toISOString(), from: 'claude', to: 'gemini', sessionId: 'S1', status: 'ok', usage: { input: 1000, output: 10, total: 1010 } });
    assert.equal(reconcile('gemini', 'S1', t, { cfg: DEFAULT_CONFIG, touch: true }), null, 'nothing new beyond the tandem call');
    fs.appendFileSync(t, step(200, 5));
    const rec = reconcile('gemini', 'S1', t, { cfg: DEFAULT_CONFIG, touch: true });
    assert.equal(rec.usage.total, 205);
  });

  it('unchanged files are skipped and idle sessions age out of the sweep window', () => {
    const t = path.join(tmp, 'idle.jsonl');
    fs.writeFileSync(t, step(300, 3));
    const t0 = Date.parse('2026-11-20T00:00:00Z');
    reconcile('gemini', 'S2', t, { cfg: DEFAULT_CONFIG, touch: true, now: t0 });
    const before = interactive().length;
    // 2 days later: the session is outside the 24h window, so the sweep doesn't even look at it.
    assert.equal(sweep(DEFAULT_CONFIG, { now: t0 + 48 * 3600_000 }), 0);
    assert.equal(interactive().length, before);
  });

  it('review with lead gemini checks Claude\'s budget, and never flips back to self-review', () => {
    const claudeOut = { claude: { known: true, exhausted: true, fiveHour: { used: 0.9 }, weekly: { used: 0.1 } }, gemini: { known: true, exhausted: false } };
    const p = route('review this diff', claudeOut, { lead: 'gemini' });
    assert.equal(p.agent, 'claude');
    assert.equal(p.self, false);
    assert.match(p.notes.join(' '), /partner review needs claude/i);
  });

  it('priceKey tolerates suffixes and falls back to the model family', () => {
    assert.equal(priceKey('claude-opus-5-5[1m]', DEFAULT_PRICING), 'claude-opus-5-5');
    assert.equal(priceKey('claude-sonnet-5-5-20261101', DEFAULT_PRICING), 'claude-sonnet-5-5');
    assert.equal(priceKey('claude-haiku-9', DEFAULT_PRICING), 'claude-haiku-5-5');
    assert.equal(priceKey('gpt-x', DEFAULT_PRICING), null);
  });

  it('hook command quotes at most one path (Windows cmd /c quote stripping)', () => {
    const cmd = hookCommand('gemini');
    assert.ok((cmd.match(/"/g) || []).length <= 2 || !cmd.startsWith('"'), cmd);
  });

  it('installClaudeHook adds once, updates a moved command, keeps other hooks', () => {
    const f = path.join(tmp, 'settings.json');
    fs.writeFileSync(f, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'notify.ps1' }] }, { hooks: [{ type: 'command', command: '"C:/old/tandem.js" hook claude' }] }] } }));
    assert.equal(installClaudeHook(f), 'added');
    assert.equal(installClaudeHook(f), 'present');
    const s = JSON.parse(fs.readFileSync(f, 'utf8'));
    assert.equal(s.hooks.Stop.length, 2);
    assert.equal(s.hooks.Stop[0].hooks[0].command, 'notify.ps1');
    assert.equal(s.hooks.UserPromptSubmit.length, 1);
    assert.ok(s.hooks.UserPromptSubmit[0].hooks[0].command.endsWith('hook claude prompt'));
    assert.ok(fs.existsSync(`${f}.bak-tandem`));

    const f2 = path.join(tmp, 'settings-prompt.json');
    fs.writeFileSync(f2, JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: hookCommand('claude') }] }],
        UserPromptSubmit: [
          { hooks: [{ type: 'command', command: 'other-prompt.ps1' }] },
          { hooks: [{ type: 'command', command: '"C:/old/tandem.js" hook claude prompt' }] },
        ],
      },
    }));
    assert.equal(installClaudeHook(f2), 'updated');
    assert.equal(installClaudeHook(f2), 'present');
    const s2 = JSON.parse(fs.readFileSync(f2, 'utf8'));
    assert.equal(s2.hooks.UserPromptSubmit.length, 2);
    assert.equal(s2.hooks.UserPromptSubmit[0].hooks[0].command, 'other-prompt.ps1');
    assert.equal(s2.hooks.UserPromptSubmit[1].hooks[0].command, hookCommand('claude', 'prompt'));

    // A stale entry before a current one must still be rewritten (not reported 'present' and skipped).
    const f3 = path.join(tmp, 'settings-dupe.json');
    fs.writeFileSync(f3, JSON.stringify({ hooks: {
      Stop: [{ hooks: [{ type: 'command', command: '"C:/old/tandem.js" hook claude' }] }, { hooks: [{ type: 'command', command: hookCommand('claude') }] }],
      UserPromptSubmit: [{ hooks: [{ type: 'command', command: hookCommand('claude', 'prompt') }] }],
    } }));
    assert.equal(installClaudeHook(f3), 'updated');
    const s3 = JSON.parse(fs.readFileSync(f3, 'utf8'));
    assert.equal(s3.hooks.Stop[0].hooks[0].command, hookCommand('claude'));

    fs.writeFileSync(f, '[]');
    assert.throws(() => installClaudeHook(f), /not a JSON object/);
  });
});
