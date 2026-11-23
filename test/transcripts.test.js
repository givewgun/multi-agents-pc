import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const prevHome = process.env.TANDEM_HOME;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-'));
process.env.TANDEM_HOME = tmpDir;

const { parseClaudeTranscript, parseGeminiTranscript, readTranscript } = await import('../src/transcripts.js');

after(() => {
  if (prevHome === undefined) delete process.env.TANDEM_HOME;
  else process.env.TANDEM_HOME = prevHome;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('transcripts', () => {
  it('parseClaudeTranscript handles user text, assistant text + tool_use (skipping thinking), tool_result, and malformed lines', () => {
    const lines = [
      'not valid json',
      '',
      JSON.stringify({ type: 'user', timestamp: 't1', message: { role: 'user', content: 'Fix the bug' } }),
      JSON.stringify({
        type: 'assistant',
        timestamp: 't2',
        message: {
          id: 'a1',
          model: 'claude-sonnet-5-5',
          content: [
            { type: 'thinking', thinking: 'internal' },
            { type: 'text', text: 'Checking file' },
            { type: 'tool_use', name: 'Read', input: { path: 'a.js' } },
          ],
        },
      }),
      JSON.stringify({
        type: 'user',
        timestamp: 't3',
        message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] },
      }),
    ];

    const msgs = parseClaudeTranscript(lines);
    assert.deepEqual(msgs, [
      { role: 'user', text: 'Fix the bug', at: 't1' },
      { role: 'assistant', text: 'Checking file', model: 'claude-sonnet-5-5', at: 't2' },
      { role: 'tool', text: 'Read({"path":"a.js"})', model: 'claude-sonnet-5-5', at: 't2' },
      { role: 'tool', text: 'ok', at: 't3' },
    ]);
  });

  it('parseGeminiTranscript handles USER_INPUT, PLANNER_RESPONSE, GENERIC with tool_calls, and malformed lines', () => {
    const lines = [
      '{bad json',
      JSON.stringify({ type: 'USER_INPUT', created_at: 'g1', content: '<USER_REQUEST>\nHello\n</USER_REQUEST>' }),
      JSON.stringify({
        type: 'PLANNER_RESPONSE',
        created_at: 'g2',
        model: 'gemini-4-neon-medium',
        content: 'Running tool',
        tool_calls: [{ name: 'run', args: { cmd: 'ls' } }],
      }),
      JSON.stringify({
        type: 'GENERIC',
        source: 'TOOL',
        created_at: 'g3',
        tool_calls: [{ name: 'read', args: { file: 'b.js' } }],
      }),
    ];

    const msgs = parseGeminiTranscript(lines);
    assert.deepEqual(msgs, [
      { role: 'user', text: 'Hello', at: 'g1' },
      { role: 'assistant', text: 'Running tool', model: 'gemini-4-neon-medium', at: 'g2' },
      { role: 'tool', text: 'run({"cmd":"ls"})', model: 'gemini-4-neon-medium', at: 'g2' },
      { role: 'tool', text: 'read({"file":"b.js"})', at: 'g3' },
    ]);
  });

  it('readTranscript on a missing file returns found: false and the right resume command', () => {
    const claudeRes = readTranscript({
      to: 'claude',
      sessionId: 'c-123',
      transcriptPath: path.join(tmpDir, 'missing-claude.jsonl'),
    });
    assert.equal(claudeRes.found, false);
    assert.equal(claudeRes.resume, 'claude --resume c-123');
    assert.deepEqual(claudeRes.messages, []);

    const geminiRes = readTranscript({
      to: 'gemini',
      sessionId: 'g-456',
      transcriptPath: path.join(tmpDir, 'missing-gemini.jsonl'),
    });
    assert.equal(geminiRes.found, false);
    assert.equal(geminiRes.resume, 'agy --conversation g-456');
    assert.deepEqual(geminiRes.messages, []);
  });
});
