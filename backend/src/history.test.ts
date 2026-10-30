import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseHistoryQuery, scanOutcome } from './history.js';
test('history defaults to bounded newest-first scans', () => {
  const query = parseHistoryQuery(new URLSearchParams());
  assert.equal(query.direction,'desc'); assert.equal(query.pageSize,10); assert.equal(query.status,'all');
});
test('history filters and exact detail IDs parse together', () => {
  const query = parseHistoryQuery(new URLSearchParams('q= PC &status=failed&page=2&direction=asc&id=00000000-0000-4000-8000-000000000001'));
  assert.equal(query.q,'PC'); assert.equal(query.status,'failed'); assert.equal(query.page,2);
});
test('history rejects unsupported, duplicate, and unbounded input', () => {
  for (const query of ['page=0','pageSize=101','status=success','direction=raw','id=invalid','deviceKey=other','q=a&q=b','page=1.5'])
    assert.throws(()=>parseHistoryQuery(new URLSearchParams(query)),query);
});
test('outcomes preserve partial failures and incomplete catalog coverage', () => {
  assert.equal(scanOutcome('completed',0),'Completed');
  assert.equal(scanOutcome('completed',2),'Completed with Warnings');
  assert.equal(scanOutcome('failed',0),'WinGet Failed');
  assert.equal(scanOutcome('not-requested',2),'Registry Only');
  assert.equal(scanOutcome('unexpected',0),'Unknown');
});
