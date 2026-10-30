import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCatalogQuery } from './catalog.js';
test('catalog defaults are bounded and use registry inventory', () => {
  const query = parseCatalogQuery(new URLSearchParams());
  assert.equal(query.pageSize, 10); assert.equal(query.source, 'registry'); assert.equal(query.direction, 'asc');
});
test('search, status, sorting, and paging compose', () => {
  const query = parseCatalogQuery(new URLSearchParams('q= Docker &source=winget&status=update&sort=installedVersion&direction=desc&page=2&pageSize=5'));
  assert.equal(query.q, 'Docker'); assert.equal(query.page, 2); assert.equal(query.status, 'update');
});
test('invalid and repeated query parameters are rejected', () => {
  for (const input of ['page=0','pageSize=101','page=abc','page=1.5','sort=raw','direction=drop','deviceKey=other','page=1&page=2','status=current'])
    assert.throws(() => parseCatalogQuery(new URLSearchParams(input)), input);
});
