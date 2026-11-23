import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { route } from '../src/router.js';

describe('route()', () => {
  it('routes unit test tasks to gemini/hydrogen (boilerplate)', () => {
    const pick = route('write unit tests for the auth module');
    assert.equal(pick.category, 'boilerplate');
    assert.equal(pick.agent, 'gemini');
    assert.equal(pick.model, 'hydrogen');
  });

  it('routes race condition debugging to claude/sonnet (hard-debug)', () => {
    const pick = route('investigate race condition in worker queue');
    assert.equal(pick.category, 'hard-debug');
    assert.equal(pick.agent, 'claude');
    assert.equal(pick.model, 'sonnet');
  });

  it('routes architecture tasks to claude/opus (architecture)', () => {
    const pick = route('design the architecture for multi-tenant billing');
    assert.equal(pick.category, 'architecture');
    assert.equal(pick.agent, 'claude');
    assert.equal(pick.model, 'opus');
  });

  it('routes "latest version of X" to gemini/neon (research)', () => {
    const pick = route('latest version of Node.js');
    assert.equal(pick.category, 'research');
    assert.equal(pick.agent, 'gemini');
    assert.equal(pick.model, 'neon');
  });

  it('routes short unknown tasks to gemini/flash-low (trivial)', () => {
    const pick = route('ping pong');
    assert.equal(pick.category, 'trivial');
    assert.equal(pick.agent, 'gemini');
    assert.equal(pick.model, 'flash-low');
  });

  it('routes bulk reading to gemini/neon (bench: exact on long inputs)', () => {
    const pick = route('summarize these logs and list all errors');
    assert.equal(pick.category, 'bulk-read');
    assert.equal(pick.model, 'neon');
  });

  // Budget shape: planBudget() — per agent plan-window usage vs. tandem's limits.
  const side = (over) => ({ known: true, exhausted: false, warn: false, fiveHour: { used: 0.1 }, weekly: { used: 0.1 }, ...over });

  it('overrides claude pick to gemini/neon-high when the Claude plan is at its limit', () => {
    const pick = route('fix race condition in cache', {
      claude: side({ exhausted: true, fiveHour: { used: 0.82 } }), gemini: side(),
    });
    assert.equal(pick.agent, 'gemini');
    assert.equal(pick.model, 'neon-high');
    assert.match(pick.notes[0], /Claude plan at its limit \(5h 82%/);
  });

  it('overrides gemini pick to claude/sonnet when the Gemini plan is at its limit', () => {
    const pick = route('write unit tests for parser', {
      claude: side(), gemini: side({ exhausted: true }), geminiQuotaHitAt: '2026-11-23T10:00:00Z',
    });
    assert.equal(pick.agent, 'claude');
    assert.equal(pick.model, 'sonnet');
    assert.match(pick.notes[0], /Gemini plan at its limit.*quota error/);
  });

  it('keeps claude and adds a warning note when the Claude plan is getting full', () => {
    const pick = route('design the architecture for billing', {
      claude: side({ warn: true, fiveHour: { used: 0.6 } }), gemini: side(),
    });
    assert.equal(pick.agent, 'claude');
    assert.equal(pick.model, 'opus');
    assert.match(pick.notes[0], /getting full \(5h 60%/);
  });

  it('unknown usage changes nothing', () => {
    const pick = route('fix race condition in cache', { claude: { known: false }, gemini: { known: false } });
    assert.equal(pick.agent, 'claude');
    assert.deepEqual(pick.notes, []);
  });
});
