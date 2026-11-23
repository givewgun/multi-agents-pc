import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { AGENTIC_TASKS } from '../src/bench/agentic-tasks.js';

function writeTree(root, files) {
  for (const [rel, body] of Object.entries(files)) {
    const target = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
  }
}

function runNodeTest(cwd, filePaths) {
  // Inside `node --test`, children inherit NODE_TEST_CONTEXT and report to the parent instead of exiting with their own status.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, ['--test', ...filePaths], {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 60_000,
    windowsHide: true,
  });
}

test('AGENTIC_TASKS has 3 tasks with unique ids and valid package.json', () => {
  assert.equal(AGENTIC_TASKS.length, 3);
  const ids = AGENTIC_TASKS.map((t) => t.id);
  assert.equal(new Set(ids).size, 3);
  assert.deepEqual(ids, ['ag-billing-bugs', 'ag-ratelimit-feature', 'ag-config-maze']);
  for (const task of AGENTIC_TASKS) {
    assert.ok(task.files['package.json'], `${task.id} missing package.json`);
    const pkg = JSON.parse(task.files['package.json']);
    assert.equal(pkg.type, 'module');
    assert.equal(pkg.scripts?.test, 'node --test');
  }
});

const VISIBLE_SHOULD_PASS = new Set(['ag-billing-bugs', 'ag-config-maze']);

for (const task of AGENTIC_TASKS) {
  test(`agentic task ${task.id}: starting state fails hidden, solution passes all`, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agt-'));
    try {
      writeTree(dir, task.files);

      const visibleFiles = Object.keys(task.files)
        .filter((f) => f.startsWith('test/') && f.endsWith('.test.js'))
        .map((f) => path.join(dir, ...f.split('/')));
      assert.ok(visibleFiles.length > 0, `${task.id} should have visible tests`);

      const visBefore = runNodeTest(dir, visibleFiles);
      if (VISIBLE_SHOULD_PASS.has(task.id)) {
        assert.equal(visBefore.status, 0, `${task.id} visible tests should pass initially:\n${visBefore.stdout}\n${visBefore.stderr}`);
      } else {
        assert.notEqual(visBefore.status, 0, `${task.id} visible tests should fail initially`);
      }

      writeTree(dir, task.hidden);
      const hiddenFiles = Object.keys(task.hidden).map((f) => path.join(dir, ...f.split('/')));
      const hidBefore = runNodeTest(dir, hiddenFiles);
      assert.notEqual(hidBefore.status, 0, `${task.id} hidden tests should fail on starting files`);

      writeTree(dir, task.solution);
      const after = runNodeTest(dir, [...visibleFiles, ...hiddenFiles]);
      assert.equal(after.status, 0, `${task.id} solution must pass all visible + hidden tests:\n${after.stdout}\n${after.stderr}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
