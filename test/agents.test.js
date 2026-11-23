import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { lastJsonLine, classifyFailure, streamResult } from '../src/agents.js';

describe('streamResult', () => {
  it('returns the envelope from the last result event', () => {
    const stdout = [
      '{"event":"init","conversation_id":"c1","init":{"model":"m"}}',
      '{"event":"step_update","text_delta":"thinking about \\"result\\""}',
      '{"event":"result","result":{"conversation_id":"c1","status":"SUCCESS","response":"30"}}',
      '',
    ].join('\n');
    assert.deepEqual(streamResult(stdout), { conversation_id: 'c1', status: 'SUCCESS', response: '30' });
  });

  it('returns null when no result event arrived', () => {
    assert.equal(streamResult('{"event":"init"}\n'), null);
    assert.equal(streamResult(''), null);
  });
});

describe('lastJsonLine', () => {
  it('parses plain JSON stdout', () => {
    assert.deepEqual(lastJsonLine('{"status":"SUCCESS","n":1}'), { status: 'SUCCESS', n: 1 });
  });

  it('extracts the last JSON line after noise lines', () => {
    const stdout = 'debug: starting\n{"old":1}\nwarning: something\n{"status":"SUCCESS","ok":true}\n';
    assert.deepEqual(lastJsonLine(stdout), { status: 'SUCCESS', ok: true });
  });

  it('returns null for empty or whitespace-only input', () => {
    assert.equal(lastJsonLine(''), null);
    assert.equal(lastJsonLine('   \r\n  '), null);
  });

  it('returns null for garbage output', () => {
    assert.equal(lastJsonLine('not json\n{broken json'), null);
  });
});

describe('classifyFailure', () => {
  it('classifies quota, 429, and RESOURCE_EXHAUSTED as quota', () => {
    assert.equal(classifyFailure('Quota exceeded for project'), 'quota');
    assert.equal(classifyFailure('HTTP 429 Too Many Requests'), 'quota');
    assert.equal(classifyFailure('Error: RESOURCE_EXHAUSTED'), 'quota');
  });

  it('classifies authentication required as auth', () => {
    assert.equal(classifyFailure('Authentication required, please sign in'), 'auth');
  });

  it('classifies other failures as error', () => {
    assert.equal(classifyFailure('unexpected exit code 1'), 'error');
  });
});
