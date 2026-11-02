import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashSecret, isOnline } from './agent-api.js';
test('credentials are deterministically hashed, not stored verbatim',()=>{
  const secret='a'.repeat(64);assert.notEqual(hashSecret(secret),secret);assert.equal(hashSecret(secret),hashSecret(secret));assert.notEqual(hashSecret(secret),hashSecret('b'.repeat(64)));
});
test('connection status expires and revoked credentials are offline',()=>{
  const now=Date.now();assert.equal(isOnline(new Date(now-10000),null,now),true);
  assert.equal(isOnline(new Date(now-45000),null,now),false);assert.equal(isOnline(null,null,now),false);
  assert.equal(isOnline(new Date(now),new Date(now),now),false);
});
