import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isLocalRequest } from '../src/dashboard/server.js';

describe('dashboard security (isLocalRequest)', () => {
  it('allows loopback hosts with or without port', () => {
    assert.equal(isLocalRequest({ host: '127.0.0.1:4777' }), true);
    assert.equal(isLocalRequest({ host: '127.0.0.1' }), true);
    assert.equal(isLocalRequest({ host: 'localhost:4777' }), true);
    assert.equal(isLocalRequest({ host: 'LOCALHOST:4777' }), true);
    assert.equal(isLocalRequest({ host: '[::1]:4777' }), true);
    assert.equal(isLocalRequest({ host: '127.0.0.1:4777', origin: 'http://127.0.0.1:4777' }), true);
  });

  it('rejects DNS rebinding and non-local hosts or origins', () => {
    assert.equal(isLocalRequest({}), false);
    assert.equal(isLocalRequest({ host: 'evil.com:4777' }), false);
    assert.equal(isLocalRequest({ host: 'localhost.evil.com:4777' }), false);
    assert.equal(isLocalRequest({ host: '127.0.0.1.evil.com' }), false);
    assert.equal(isLocalRequest({ host: '127.0.0.1:4777', origin: 'https://evil.com' }), false);
    assert.equal(isLocalRequest({ host: '127.0.0.1:4777', origin: 'null' }), false);
  });
});
