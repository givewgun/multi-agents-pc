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

  it('overrides claude pick to gemini/neon-high when claudeWeek ratio >= 1', () => {
    const pick = route('fix race condition in cache', {
      warnAt: 0.8,
      claudeWeek: { ratio: 1.0 },
    });
    assert.equal(pick.agent, 'gemini');
    assert.equal(pick.model, 'neon-high');
    assert.ok(pick.notes.length > 0);
    assert.match(pick.notes[0], /100%/);
  });

  it('overrides gemini pick to claude/sonnet when geminiLikelyLimited is true', () => {
    const pick = route('write unit tests for parser', {
      warnAt: 0.8,
      geminiLikelyLimited: true,
    });
    assert.equal(pick.agent, 'claude');
    assert.equal(pick.model, 'sonnet');
    assert.ok(pick.notes.length > 0);
    assert.match(pick.notes[0], /Gemini quota/i);
  });

  it('keeps claude and adds a warning note when claudeWeek ratio >= warnAt', () => {
    const pick = route('design the architecture for billing', {
      warnAt: 0.8,
      claudeWeek: { ratio: 0.85 },
    });
    assert.equal(pick.agent, 'claude');
    assert.equal(pick.model, 'opus');
    assert.ok(pick.notes.length > 0);
    assert.match(pick.notes[0], /85%/);
  });
});
