import test from 'node:test';
import assert from 'node:assert/strict';
import { tapCounts, delegations, leadOpts, analyzeAgentic } from '../src/bench/agentic.js';

test('tapCounts reads node --test TAP summary', () => {
  assert.deepEqual(tapCounts('ok 1\n# tests 5\n# pass 3\n# fail 1\n# cancelled 1\n'), { pass: 3, fail: 2, total: 5 });
  assert.deepEqual(tapCounts('garbage'), { pass: 0, fail: 0, total: 0 });
});

test('delegations keeps only partner calls for this workdir since start', () => {
  const recs = [
    { project: 'p1', ts: '2026-01-01T00:00:01Z', from: 'claude' },
    { project: 'p1', ts: '2026-01-01T00:00:02Z', from: 'bench' },
    { project: 'p2', ts: '2026-01-01T00:00:03Z', from: 'claude' },
    { project: 'p1', ts: '2025-12-31T00:00:00Z', from: 'gemini' },
  ];
  assert.equal(delegations(recs, 'p1', '2026-01-01T00:00:00Z').length, 1);
});

test('leadOpts: solo Claude cannot reach tandem MCP; team lead gets partner tool + hint', () => {
  const solo = leadOpts('claude-solo', 'TASK', '/w');
  assert.deepEqual(solo.disallow, ['mcp__tandem']);
  assert.ok(!solo.allow.includes('mcp__tandem__ask_gemini'));
  assert.doesNotMatch(solo.prompt, /ask_gemini/);
  const team = leadOpts('claude-lead', 'TASK', '/w');
  assert.ok(team.allow.includes('mcp__tandem__ask_gemini'));
  assert.match(team.prompt, /ask_gemini/);
  const g = leadOpts('gemini-lead', 'TASK', '/w');
  assert.ok(g.allow.includes('mcp(tandem_tandem/ask_claude)'));
  assert.equal(g.edit, true);
  assert.ok(!leadOpts('gemini-solo', 'T', '/w').allow.some((a) => a.includes('ask_claude')));
});

test('analyzeAgentic totals Claude spend and partner calls', () => {
  const rs = [
    { task: 'a', setup: 'claude-lead', score: 1, pass: true, ms: 10, claudeUsd: 0.4, delegations: 2, hidden: '5/5' },
    { task: 'a', setup: 'claude-solo', score: 0.6, pass: false, ms: 20, claudeUsd: 0.7, delegations: 0, hidden: '3/5' },
  ];
  const r = analyzeAgentic(rs, ['claude-solo', 'claude-lead'], [{ id: 'a' }]);
  assert.equal(r.perSetup[1].delegations, 2);
  assert.equal(r.perTask[0].cells['claude-lead'], '5/5 (2↗)');
  assert.equal(r.perTask[0].cells['claude-solo'], '3/5');
});

test('headlessNote advertises per-call command grants', async () => {
  const { headlessNote } = await import('../src/agents.js');
  assert.match(headlessNote(true, ['command(node --test)', 'mcp(a/b)']), /also allowed for this run: `node --test`\)/);
  assert.doesNotMatch(headlessNote(true), /also allowed/);
});

test('mergeGeminiPermissions keeps the user allow/deny rules', async () => {
  const { mergeGeminiPermissions } = await import('../src/agents.js');
  const m = mergeGeminiPermissions(['command(node --test)', 'command(git diff)'], { permissions: { allow: ['command(git diff)'], deny: ['command(rm)'] } });
  assert.deepEqual(m, { permissions: { allow: ['command(git diff)', 'command(node --test)'], deny: ['command(rm)'] } });
  assert.deepEqual(mergeGeminiPermissions(['x'], {}), { permissions: { allow: ['x'] } });
});
