import 'dotenv/config';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
const port = 14019;
const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'ignore', 'pipe'] });
child.stderr.on('data', () => {});
let failed = false; child.on('error', () => { failed = true; });
try {
  let response;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (failed || child.exitCode !== null) throw new Error('Test API could not start.');
    try { response = await fetch(`http://127.0.0.1:${port}/api/v1/dashboard`, { signal: AbortSignal.timeout(1000) }); break; }
    catch { await new Promise(resolve => setTimeout(resolve, 200)); }
  }
  assert.equal(response?.status, 401);
  const headers = { Authorization: `Bearer ${process.env.BACKEND_API_TOKEN}` };
  const result = await fetch(`http://127.0.0.1:${port}/api/v1/dashboard`, { headers, signal: AbortSignal.timeout(15000) });
  assert.equal(result.status, 200, 'Authenticated dashboard must query PostgreSQL successfully');
  const data = await result.json();
  assert.ok(['ready', 'empty'].includes(data.state));
  const post = await fetch(`http://127.0.0.1:${port}/api/v1/dashboard`, { method: 'POST', headers });
  assert.equal(post.status, 405);
  process.env.BACKEND_API_URL = `http://127.0.0.1:${port}`;
  const { GET } = await import('../../frontend/app/api/dashboard/route.ts');
  const proxied = await GET(new Request('http://localhost:3000/api/dashboard'));
  assert.equal(proxied.status, 200);
  const proxiedData = await proxied.json();
  assert.equal(proxiedData.updatesAvailable, data.updatesAvailable);
  assert.equal(proxiedData.registryEntries, data.registryEntries);
  const forbidden = await GET(new Request('http://untrusted.example/api/dashboard'));
  assert.equal(forbidden.status, 403);
  console.log('Frontend proxy and local-origin checks passed.');
  const catalog = async path => {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/${path}`, { headers });
    assert.equal(res.status, 200); return res.json();
  };
  const registry = await catalog('applications?pageSize=5');
  assert.equal(registry.total, data.registryEntries); assert.ok(registry.rows.length <= 5);
  assert.ok(registry.rows.every(row => row.status === 'unmatched' && row.packageId === null));
  const packages = await catalog('applications?source=winget&pageSize=5');
  assert.equal(packages.total, data.wingetEntries);
  const updates = await catalog('updates?pageSize=5');
  assert.equal(updates.total, data.updatesAvailable);
  assert.ok(updates.rows.every(row => row.source === 'winget' && row.status === 'update'));
  if (registry.total > 5) {
    const next = await catalog('applications?pageSize=5&page=2');
    assert.equal(next.page, 2); assert.ok(next.rows.every(row => !registry.rows.some(first => first.id === row.id)));
  }
  if (updates.rows.length) {
    const found = await catalog(`updates?q=${encodeURIComponent(updates.rows[0].packageId)}&direction=desc`);
    assert.ok(found.rows.some(row => row.packageId === updates.rows[0].packageId));
  }
  const invalid = await fetch(`http://127.0.0.1:${port}/api/v1/applications?pageSize=101`, { headers });
  assert.equal(invalid.status, 400);
  const { proxyCatalog } = await import('../../frontend/lib/backend-proxy.ts');
  const listProxy = await proxyCatalog(new Request('http://localhost:3000/api/updates?pageSize=5'), 'updates');
  assert.equal(listProxy.status, 200); assert.equal((await listProxy.json()).total, data.updatesAvailable);
  console.log('Live inventory counts, search, pagination, source separation, parameter validation, and proxy passed.');
  console.log(JSON.stringify({ authentication: 'passed', readOnly: 'passed', state: data.state, registryEntries: data.registryEntries, wingetEntries: data.wingetEntries, updatesAvailable: data.updatesAvailable }, null, 2));
} finally { child.kill(); }
