import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HARD_TASKS } from '../src/bench/hard-tasks.js';

const DIRECT = 'Answer directly from the information below. Do not use any tools, files, or shell commands.\n\n';
const js = (code) => '```js\n' + code + '\n```';

describe('hard bench tasks', () => {
  it('defines 5 tasks with unique ids and required prompt framing', () => {
    assert.equal(HARD_TASKS.length, 5);
    assert.equal(new Set(HARD_TASKS.map((t) => t.id)).size, 5);
    for (const t of HARD_TASKS) {
      assert.equal(t.category, 'feature');
      assert.ok(t.prompt.startsWith(DIRECT), `${t.id} missing DIRECT prefix`);
      assert.ok(t.prompt.trimEnd().endsWith('Reply with only the code in one ```js block.'), `${t.id} missing code fence footer`);
    }
  });

  for (const task of HARD_TASKS) {
    it(`${task.id} passes reference and fails stub/eval`, () => {
      const good = task.grade(js(task.reference));
      assert.equal(good.pass, true, good.why);
      assert.equal(good.score, 1, good.why);

      const bad = task.grade(js('function nope(){}'));
      assert.equal(bad.pass, false);
      assert.ok(bad.score < 1, `expected score < 1, got ${bad.score}`);

      const sneaky = task.grade(js('eval("1")'));
      assert.equal(sneaky.pass, false);
      assert.equal(sneaky.score, 0);
    });
  }
});
