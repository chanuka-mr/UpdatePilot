import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareVersions, matchedRanges } from '../src/modules/security/security.js';
import { normalizeInstalledVersion, securityMappingFor } from '../src/modules/security/mappings.js';

const anydesk = { vendor: 'anydesk', product: 'anydesk' };
const cve = (criteria: string, range: Record<string, string>, platform = 'windows') => ({
  configurations: [{ operator: 'AND', nodes: [
    { operator: 'OR', cpeMatch: [{ vulnerable: true, criteria, ...range }] },
    { operator: 'OR', cpeMatch: [{ vulnerable: false, criteria: `cpe:2.3:o:microsoft:${platform}:-:*:*:*:*:*:*:*` }] },
  ] }],
});

test('normalizes real WinGet installed versions without guessing absent versions', () => {
  assert.equal(normalizeInstalledVersion('ad 9.7.13'), '9.7.13');
  assert.equal(normalizeInstalledVersion('3.0.20'), '3.0.20');
  assert.equal(normalizeInstalledVersion('4.69.0'), '4.69.0');
  assert.equal(normalizeInstalledVersion('unknown'), null);
  assert.equal(normalizeInstalledVersion(null), null);
});

test('curated mappings are exact and do not guess package identities', () => {
  assert.deepEqual(securityMappingFor('AnyDesk.AnyDesk'), { packageId: 'AnyDesk.AnyDesk', ...anydesk });
  assert.deepEqual(securityMappingFor('anydesk.anydesk'), { packageId: 'AnyDesk.AnyDesk', ...anydesk });
  assert.equal(securityMappingFor('Some.AnyDesk.Fork'), null);
  assert.deepEqual(securityMappingFor('VideoLAN.VLC'), { packageId: 'VideoLAN.VLC', vendor: 'videolan', product: 'vlc_media_player' });
});

test('version comparison handles dotted, numeric, and prerelease-ish strings', () => {
  assert.equal(compareVersions('9.7.13', '9.7.13'), 0);
  assert.equal(compareVersions('9.7.13', '3.6.0'), 1);
  assert.equal(compareVersions('3.6.0', '3.6.1'), -1);
  assert.equal(compareVersions('1.0', '1.0.0'), 0);
  assert.equal(compareVersions('1.0.0-beta', '1.0.0'), -1);
});

test('only vulnerable Windows CPE ranges containing the installed version produce findings', () => {
  const pre361 = cve('cpe:2.3:a:anydesk:anydesk:*:*:*:*:*:*:*:*', { versionEndExcluding: '3.6.1' });
  assert.deepEqual(matchedRanges(pre361, anydesk, '3.6.0'), ['< 3.6.1']);
  assert.equal(matchedRanges(pre361, anydesk, '3.6.1'), null);
  assert.equal(matchedRanges(pre361, anydesk, '9.7.13'), null);
  assert.equal(matchedRanges(cve('cpe:2.3:a:other:product:*:*:*:*:*:*:*:*', {}, 'windows'), anydesk, '1.0'), null);
});

test('non-Windows-only configurations are not treated as verified findings on this device', () => {
  const linuxOnly = cve('cpe:2.3:a:anydesk:anydesk:*:*:*:*:*:*:*:*', { versionEndIncluding: '9.9.9' }, 'linux');
  assert.equal(matchedRanges(linuxOnly, anydesk, '9.7.13'), null);
  const windows = cve('cpe:2.3:a:anydesk:anydesk:*:*:*:*:*:*:*:*', { versionEndIncluding: '9.9.9' }, 'windows');
  assert.deepEqual(matchedRanges(windows, anydesk, '9.7.13'), ['<= 9.9.9']);
});

test('unbounded wildcard CPEs are not reported as verified findings', () => {
  const unbounded = cve('cpe:2.3:a:anydesk:anydesk:*:*:*:*:*:*:*:*', {});
  assert.equal(matchedRanges(unbounded, anydesk, '9.7.13'), null);
});

test('explicit versions and start ranges are evaluated', () => {
  const exact = cve('cpe:2.3:a:anydesk:anydesk:9.8.3:*:*:*:*:*:*:*', {});
  assert.deepEqual(matchedRanges(exact, anydesk, '9.8.3'), ['= 9.8.3']);
  assert.equal(matchedRanges(exact, anydesk, '9.8.2'), null);
  const range = cve('cpe:2.3:a:anydesk:anydesk:*:*:*:*:*:*:*:*', { versionStartIncluding: '9.0.0', versionEndExcluding: '10.0.0' });
  assert.deepEqual(matchedRanges(range, anydesk, '9.7.13'), ['>= 9.0.0, < 10.0.0']);
});
