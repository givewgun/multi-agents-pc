import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { route, RULES, CATEGORIES, GENERAL, checkCategory } from '../src/router.js';

describe('route() classification regression fixtures', () => {
  const fixtures = [
    // architecture
    ['design a data model for multi-tenant billing', 'architecture'],
    ['threat model and trade-offs for our sync engine', 'architecture'],
    // hard-debug
    ['find root cause of intermittent deadlock in worker pool', 'hard-debug'],
    ['memory leak and regression in connection pool', 'hard-debug'],
    // research
    ['compare sqlite vs duckdb pricing and alternatives', 'research'],
    ['latest release notes and docs for node 22', 'research'],
    // review
    ['review this pull request before merge', 'review'],
    ['look over my patch for the router', 'review'],
    // second-opinion
    ['give me a second opinion and poke holes in this plan', 'second-opinion'],
    ["sanity check my rollout plan and play devil's advocate", 'second-opinion'],
    // ui
    ['make the landing page layout responsive with dark mode', 'ui'],
    ['style the nav component with tailwind css', 'ui'],
    // bulk-read
    ['map the codebase and list all entry points', 'bulk-read'],
    ['summarize the server logs and find every timeout', 'bulk-read'],
    // boilerplate
    ['scaffold crud handlers and add jsdoc comments', 'boilerplate'],
    ['write tests and update readme for the cli', 'boilerplate'],
    // feature
    ['implement a webhook retry endpoint', 'feature'],
    ['add a flag to dry-run the importer and refactor the parser', 'feature'],
    // trivial
    ['write a regex for iso 8601 dates', 'trivial'],
    ['draft a commit message for the typo fix', 'trivial'],
  ];

  for (const [prompt, expected] of fixtures) {
    it(`classifies "${prompt}" as ${expected}`, () => {
      const pick = route(prompt);
      assert.equal(pick.category, expected);
      assert.equal(pick.source, 'rules');
    });
  }

  const unmatched = [
    'need to mod skyrim and modify papyrus script of enb',
    'tune my 3d printer klipper config',
    'calibrate pid gains on my quadcopter flight controller',
  ];

  for (const prompt of unmatched) {
    it(`falls back to general with needsJudgment for "${prompt}"`, () => {
      const pick = route(prompt);
      assert.equal(pick.category, GENERAL.category);
      assert.equal(pick.source, 'rules');
      assert.equal(pick.needsJudgment, true);
    });
  }
});

describe('route() mixed intent', () => {
  it('flags needsJudgment and suggests splitting when intents tie or are close', () => {
    const pick = route('review this diff and write unit tests');
    assert.equal(pick.source, 'rules');
    assert.equal(pick.needsJudgment, true);
    assert.ok(pick.notes.some((n) => n.includes('split')), `expected a note containing "split", got: ${JSON.stringify(pick.notes)}`);
  });
});

describe('route() category option', () => {
  it('uses lead category directly with confidence 1 and needsJudgment false', () => {
    const pick = route('anything', null, { category: 'research' });
    assert.equal(pick.category, 'research');
    assert.equal(pick.source, 'lead');
    assert.equal(pick.confidence, 1);
    assert.equal(pick.agent, 'gemini');
    assert.equal(pick.model, 'neon');
    assert.equal(pick.needsJudgment, false);
  });

  it('accepts category "general"', () => {
    const pick = route('anything', null, { category: 'general' });
    assert.equal(pick.category, 'general');
    assert.equal(pick.source, 'lead');
    assert.equal(pick.confidence, 1);
    assert.equal(pick.agent, GENERAL.agent);
    assert.equal(pick.model, GENERAL.model);
    assert.equal(pick.needsJudgment, false);
  });

  it('sets self: true when lead matches the category agent', () => {
    const pick = route('anything', null, { lead: 'claude', category: 'architecture' });
    assert.equal(pick.category, 'architecture');
    assert.equal(pick.agent, 'claude');
    assert.equal(pick.self, true);
  });

  it('still enforces partner rule for review when lead is gemini', () => {
    const pick = route('anything', null, { lead: 'gemini', category: 'review' });
    assert.equal(pick.category, 'review');
    assert.equal(pick.agent, 'claude');
    assert.equal(pick.self, false);
  });

  it('lets user pins override a lead category', () => {
    const pick = route('anything', null, {
      category: 'research',
      pins: { research: 'claude:opus' },
    });
    assert.equal(pick.category, 'research');
    assert.equal(pick.source, 'lead');
    assert.equal(pick.agent, 'claude');
    assert.equal(pick.model, 'opus');
    assert.equal(pick.pinned, true);
  });
});

describe('checkCategory() and CATEGORIES', () => {
  it('throws Unknown category for invalid category values', () => {
    assert.throws(() => checkCategory('not-a-category'), /Unknown category/);
    assert.throws(() => route('anything', null, { category: 'bogus' }), /Unknown category/);
  });

  it('returns null for empty string and undefined', () => {
    assert.equal(checkCategory(''), null);
    assert.equal(checkCategory(undefined), null);
  });

  it('CATEGORIES includes every RULES category plus general', () => {
    for (const rule of RULES) {
      assert.ok(CATEGORIES.includes(rule.category), `missing ${rule.category}`);
    }
    assert.ok(CATEGORIES.includes('general'));
    assert.equal(CATEGORIES.length, RULES.length + 1);
  });
});
