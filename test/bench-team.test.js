import test from 'node:test';
import assert from 'node:assert/strict';
import { applyReview, extractCode, analyzeTeam, scoreOf, STRATEGIES, reviewPrompt } from '../src/bench/team.js';

test('applyReview keeps draft on LGTM, failure or prose; takes fixed code otherwise', () => {
  const draft = '```js\nfunction f(){return 1}\n```';
  assert.equal(applyReview(draft, { ok: true, text: 'LGTM' }).text, draft);
  assert.equal(applyReview(draft, { ok: true, text: ' lgtm. ' }).approved, true);
  assert.equal(applyReview(draft, { ok: false, text: '' }).degraded, true);
  const fixed = applyReview(draft, { ok: true, text: '```js\nfunction f(){return 2}\n```' });
  assert.equal(fixed.approved, false);
  assert.equal(extractCode(fixed.text), 'function f(){return 2}');
});

test('reviewPrompt embeds the task and the extracted draft code', () => {
  const p = reviewPrompt({ prompt: 'SPEC' }, 'blah ```js\nCODE\n``` blah');
  assert.match(p, /SPEC/);
  assert.match(p, /```js\nCODE\n```/);
});

test('scoreOf falls back to pass for binary graders', () => {
  assert.equal(scoreOf({ pass: true }), 1);
  assert.equal(scoreOf({ pass: false }), 0);
  assert.equal(scoreOf({ pass: false, score: 0.5 }), 0.5);
});

test('analyzeTeam aggregates score, Claude spend and fix rate', () => {
  const names = ['solo-gemini', 'draft-review'];
  const results = [
    { task: 'a', strategy: 'solo-gemini', score: 0.5, pass: false, ms: 10, claudeUsd: 0, claudeTokens: 0, approved: null },
    { task: 'a', strategy: 'draft-review', score: 1, pass: true, ms: 30, claudeUsd: 0.1, claudeTokens: 100, approved: false },
    { task: 'b', strategy: 'draft-review', score: 1, pass: true, ms: 10, claudeUsd: 0.05, claudeTokens: 50, approved: true },
  ];
  const r = analyzeTeam(results, names, [{ id: 'a' }, { id: 'b' }]);
  const dr = r.perStrategy.find((p) => p.strategy === 'draft-review');
  assert.equal(dr.avgScore, 1);
  assert.equal(dr.fixRate, 0.5);
  assert.ok(Math.abs(dr.claudeUsd - 0.15) < 1e-12);
  assert.equal(r.perTask[0].scores['solo-gemini'], 0.5);
  assert.ok(Object.keys(STRATEGIES).includes('plan-execute'));
});
