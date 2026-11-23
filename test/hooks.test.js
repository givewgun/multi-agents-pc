import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const prevHome = process.env.TANDEM_HOME;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-'));
process.env.TANDEM_HOME = tmpDir;

const { claudeUsage, geminiUsage, readNewLines, sweep } = await import('../src/hooks.js');
const { readRecords } = await import('../src/ledger.js');
const { DEFAULT_CONFIG } = await import('../src/config.js');

after(() => {
  if (prevHome === undefined) delete process.env.TANDEM_HOME;
  else process.env.TANDEM_HOME = prevHome;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('hooks', () => {
  it('claudeUsage deduplicates by message.id (last wins), adds cache to input, and ignores non-assistant', () => {
    const lines = [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi', usage: { input_tokens: 999 } } }),
      'not json',
      JSON.stringify({
        type: 'assistant',
        message: {
          id: 'm1',
          model: 'claude-sonnet-5-5',
          usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 20, cache_creation_input_tokens: 30 },
        },
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          id: 'm1',
          model: 'claude-sonnet-5-5',
          usage: { input_tokens: 10, output_tokens: 25, cache_read_input_tokens: 20, cache_creation_input_tokens: 30 },
        },
      }),
    ];
    const res = claudeUsage(lines);
    assert.equal(res.turns, 1);
    assert.equal(res.model, 'claude-sonnet-5-5');
    assert.equal(res.usage.cacheRead, 20);
    assert.equal(res.usage.cacheWrite, 30);
    assert.equal(res.usage.input, 60);
    assert.equal(res.usage.output, 25);
    assert.equal(res.usage.total, 85);
  });

  it('geminiUsage sums tokens, skips lines without tokens, and takes model', () => {
    const lines = [
      JSON.stringify({ type: 'USER_INPUT', content: 'hello' }),
      JSON.stringify({ type: 'PLANNER_RESPONSE', model: 'gemini-4-neon-medium', input_tokens: 100, output_tokens: 40, cache_read_tokens: 25 }),
      JSON.stringify({ type: 'PLANNER_RESPONSE', input_tokens: 50, output_tokens: 10 }),
    ];
    const res = geminiUsage(lines);
    assert.equal(res.turns, 2);
    assert.equal(res.model, 'gemini-4-neon-medium');
    assert.equal(res.usage.input, 150);
    assert.equal(res.usage.output, 50);
    assert.equal(res.usage.cacheRead, 25);
    assert.equal(res.usage.total, 200);
  });

  it('readNewLines ignores trailing partial line, returns offset after last newline, and resets on shrink', () => {
    const file = path.join(tmpDir, 'lines.txt');
    fs.writeFileSync(file, 'a\nb\npartial');
    const r1 = readNewLines(file, 0);
    assert.deepEqual(r1.lines, ['a', 'b']);
    assert.equal(r1.offset, Buffer.byteLength('a\nb\n'));

    fs.appendFileSync(file, ' line\n');
    const r2 = readNewLines(file, r1.offset);
    assert.deepEqual(r2.lines, ['partial line']);
    assert.equal(r2.offset, Buffer.byteLength('a\nb\npartial line\n'));

    fs.writeFileSync(file, 'x\n');
    const r3 = readNewLines(file, r2.offset);
    assert.deepEqual(r3.lines, ['x']);
    assert.equal(r3.offset, Buffer.byteLength('x\n'));
  });

  it('sweep reconciles interactive gemini transcript deltas and skips when unchanged', () => {
    const transcript = path.join(tmpDir, 'gemini-s1.jsonl');
    fs.writeFileSync(
      transcript,
      JSON.stringify({ type: 'PLANNER_RESPONSE', model: 'gemini-4-neon-medium', input_tokens: 100, output_tokens: 40 }) + '\n',
    );
    fs.writeFileSync(
      path.join(tmpDir, 'hook-state.json'),
      JSON.stringify({
        gemini: {
          s1: { path: transcript, cwd: tmpDir, logged: {}, turns: 0, at: new Date().toISOString() },
        },
      }),
    );

    assert.equal(sweep(DEFAULT_CONFIG), 1);
    let recs = readRecords();
    assert.equal(recs.length, 1);
    assert.equal(recs[0].tag, 'interactive');
    assert.equal(recs[0].to, 'gemini');
    assert.equal(recs[0].usage.input, 100);
    assert.equal(recs[0].usage.output, 40);
    assert.equal(recs[0].turns, 1);

    fs.appendFileSync(
      transcript,
      JSON.stringify({ type: 'PLANNER_RESPONSE', model: 'gemini-4-neon-medium', input_tokens: 60, output_tokens: 15 }) + '\n',
    );
    assert.equal(sweep(DEFAULT_CONFIG), 1);
    recs = readRecords();
    assert.equal(recs.length, 2);
    assert.equal(recs[1].tag, 'interactive');
    assert.equal(recs[1].usage.input, 60);
    assert.equal(recs[1].usage.output, 15);
    assert.equal(recs[1].turns, 1);

    assert.equal(sweep(DEFAULT_CONFIG), 0);
    assert.equal(readRecords().length, 2);
  });
});
