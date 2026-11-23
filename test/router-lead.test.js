import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const prevHome = process.env.TANDEM_HOME;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-'));
process.env.TANDEM_HOME = tmpDir;

const { route, parsePin } = await import('../src/router.js');

after(() => {
  if (prevHome === undefined) delete process.env.TANDEM_HOME;
  else process.env.TANDEM_HOME = prevHome;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('route() lead and pins', () => {
  it('flips review with lead gemini to claude and notes partner', () => {
    const pick = route('review this diff', null, { lead: 'gemini' });
    assert.equal(pick.category, 'review');
    assert.equal(pick.agent, 'claude');
    assert.equal(pick.model, 'sonnet');
    assert.equal(pick.self, false);
    assert.ok(pick.notes.some((n) => /partner/i.test(n)));
  });

  it('keeps review with lead claude on gemini', () => {
    const pick = route('review this diff', null, { lead: 'claude' });
    assert.equal(pick.category, 'review');
    assert.equal(pick.agent, 'gemini');
    assert.equal(pick.model, 'neon');
    assert.equal(pick.self, false);
  });

  it('marks boilerplate with lead gemini as self: true', () => {
    const pick = route('write unit tests for parser', null, { lead: 'gemini' });
    assert.equal(pick.category, 'boilerplate');
    assert.equal(pick.agent, 'gemini');
    assert.equal(pick.self, true);
  });

  it('marks hard-debug with lead claude as self: true', () => {
    const pick = route('investigate race condition in worker', null, { lead: 'claude' });
    assert.equal(pick.category, 'hard-debug');
    assert.equal(pick.agent, 'claude');
    assert.equal(pick.self, true);
  });

  it('keeps a user pin even when lead matches the pinned partnerRequired agent', () => {
    const pick = route('review this diff', null, { lead: 'claude', pins: { review: 'claude:opus' } });
    assert.equal(pick.agent, 'claude');
    assert.equal(pick.model, 'opus');
    assert.equal(pick.pinned, true);
    assert.equal(pick.self, true);
  });

  it('keeps a pinned agent at its plan limit and adds a note', () => {
    const budget = {
      claude: { known: true, exhausted: true, fiveHour: { used: 0.9 }, weekly: { used: 0.2 } },
      gemini: { known: true, exhausted: false, fiveHour: { used: 0.1 }, weekly: { used: 0.1 } },
    };
    const pick = route('review this diff', budget, { pins: { review: 'claude:opus' } });
    assert.equal(pick.agent, 'claude');
    assert.equal(pick.model, 'opus');
    assert.equal(pick.pinned, true);
    assert.ok(pick.notes.some((n) => /pin keeps claude.*limit/i.test(n)));
  });

  it('parsePin("gemini") defaults model to neon', () => {
    assert.deepEqual(parsePin('gemini'), { agent: 'gemini', model: 'neon' });
  });

  it('parsePin("x:y") throws on unknown agent', () => {
    assert.throws(() => parsePin('x:y'), /Bad pin/);
  });

  it('routes "second opinion on this plan" as second-opinion with partnerRequired', () => {
    const pick = route('second opinion on this plan');
    assert.equal(pick.category, 'second-opinion');
    assert.equal(pick.partnerRequired, true);
  });
});
