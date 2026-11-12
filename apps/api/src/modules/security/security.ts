import type { PrismaClient } from '../../../generated/prisma/client.js';
import { normalizeInstalledVersion, securityMappingFor, type SecurityMapping } from './mappings.js';

const NVD_ENDPOINT = 'https://services.nvd.nist.gov/rest/json/cves/2.0';
const NVD_CACHE_TTL = 6 * 60 * 60 * 1000;
const NVD_PAGE_SIZE = 2000;
const NVD_MAX_PAGES = 5;

type CpeMatch = { vulnerable?: unknown; criteria?: unknown; versionStartIncluding?: unknown; versionStartExcluding?: unknown;
  versionEndIncluding?: unknown; versionEndExcluding?: unknown };
type NvdCve = { id?: unknown; published?: unknown; lastModified?: unknown; descriptions?: unknown; metrics?: unknown;
  configurations?: unknown };
type CacheEntry = { expiresAt: number; cves: NvdCve[]; truncated: boolean };
type Finding = { cveId: string; description: string; severity: string; score: number | null; cvssVersion: string | null;
  published: string | null; lastModified: string | null; matchedRanges: string[]; url: string };
export type SecurityFindingRow = {
  id: string; name: string; packageId: string; installedVersion: string | null; normalizedVersion: string | null;
  mappingStatus: 'mapped' | 'unmapped' | 'unparseable';
  status: 'findings' | 'none' | 'unavailable' | 'unparseable' | 'unmapped';
  mapping: { vendor: string; product: string } | null; findings: Finding[]; error?: string; note?: string;
};

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<CacheEntry>>();
let requestChain: Promise<void> = Promise.resolve();
let lastRequestAt = 0;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const string = (value: unknown) => typeof value === 'string' ? value : null;
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;

function scheduled<T>(task: () => Promise<T>) {
  const run = requestChain.then(async () => {
    const interval = process.env.NVD_API_KEY ? 700 : 6500;
    const wait = interval - (Date.now() - lastRequestAt);
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    return task();
  });
  requestChain = run.then(() => undefined, () => undefined);
  return run;
}

async function nvdPage(mapping: SecurityMapping, startIndex: number) {
  const cpe = `cpe:2.3:a:${mapping.vendor}:${mapping.product}`;
  const url = new URL(NVD_ENDPOINT);
  url.searchParams.set('virtualMatchString', cpe);
  url.searchParams.set('resultsPerPage', String(NVD_PAGE_SIZE));
  url.searchParams.set('startIndex', String(startIndex));
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (process.env.NVD_API_KEY) headers.apiKey = process.env.NVD_API_KEY;
  return scheduled(async () => {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`NVD returned ${response.status}.`);
    const payload = await response.json() as { totalResults?: unknown; vulnerabilities?: unknown };
    const vulnerabilities = Array.isArray(payload.vulnerabilities) ? payload.vulnerabilities : [];
    const cves = vulnerabilities.flatMap(entry => {
      const cve = entry && typeof entry === 'object' ? (entry as { cve?: unknown }).cve : null;
      return cve && typeof cve === 'object' ? [cve as NvdCve] : [];
    });
    return { total: number(payload.totalResults) ?? cves.length, cves };
  });
}

async function productCves(mapping: SecurityMapping): Promise<CacheEntry> {
  const key = `${mapping.vendor}:${mapping.product}`.toLowerCase();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached;
  const pending = inflight.get(key);
  if (pending) return pending;
  const promise = (async () => {
    const cves: NvdCve[] = []; let startIndex = 0; let total = 0; let truncated = false;
    for (let page = 0; page < NVD_MAX_PAGES; page++) {
      const result = await nvdPage(mapping, startIndex);
      total = result.total;
      cves.push(...result.cves);
      startIndex += result.cves.length;
      if (!result.cves.length || startIndex >= total) break;
      if (page === NVD_MAX_PAGES - 1) truncated = true;
    }
    const entry = { expiresAt: Date.now() + NVD_CACHE_TTL, cves, truncated };
    cache.set(key, entry);
    return entry;
  })();
  inflight.set(key, promise);
  try { return await promise; } finally { inflight.delete(key); }
}

function collectMatches(value: unknown, result: CpeMatch[] = []) {
  if (Array.isArray(value)) { for (const item of value) collectMatches(item, result); return result; }
  if (!value || typeof value !== 'object') return result;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.cpeMatch)) for (const item of record.cpeMatch) if (item && typeof item === 'object') result.push(item as CpeMatch);
  for (const key of ['nodes', 'children']) if (record[key]) collectMatches(record[key], result);
  return result;
}

function cpeParts(criteria: string) {
  const parts = criteria.split(':');
  if (parts.length < 6 || parts[0] !== 'cpe' || parts[1] !== '2.3') return null;
  return { part: parts[2], vendor: parts[3].toLowerCase(), product: parts[4].toLowerCase(), version: parts[5] };
}

function unescapeCpe(value: string) { return value.replace(/\\(.)/g, '$1'); }

function tokens(version: string) {
  return version.toLowerCase().match(/\d+|[a-z]+/g) ?? [];
}

export function compareVersions(left: string, right: string) {
  const a = tokens(left), b = tokens(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) {
    const x = a[index], y = b[index];
    if (x === undefined && y === undefined) return 0;
    if (x === undefined) {
      if (y !== undefined && /^\d+$/.test(y) && Number(y) === 0) continue;
      return y !== undefined && /^\d+$/.test(y) ? -1 : 1;
    }
    if (y === undefined) {
      if (/^\d+$/.test(x) && Number(x) === 0) continue;
      return /^\d+$/.test(x) ? 1 : -1;
    }
    const xNumeric = /^\d+$/.test(x), yNumeric = /^\d+$/.test(y);
    if (xNumeric && yNumeric) { const difference = Number(x) - Number(y); if (difference) return difference < 0 ? -1 : 1; }
    else if (xNumeric !== yNumeric) return xNumeric ? 1 : -1;
    else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

function versionMatch(match: CpeMatch, installedVersion: string) {
  const criteria = string(match.criteria);
  if (!criteria) return false;
  const parts = cpeParts(criteria);
  if (!parts) return false;
  const explicit = parts.version;
  if (explicit && explicit !== '*' && explicit !== '-') {
    const expected = unescapeCpe(explicit);
    if (compareVersions(installedVersion, expected) !== 0) return false;
  }
  const startIncluding = string(match.versionStartIncluding);
  const startExcluding = string(match.versionStartExcluding);
  const endIncluding = string(match.versionEndIncluding);
  const endExcluding = string(match.versionEndExcluding);
  if (!startIncluding && !startExcluding && !endIncluding && !endExcluding && (!explicit || explicit === '*' || explicit === '-')) return false;
  if (startIncluding && compareVersions(installedVersion, startIncluding) < 0) return false;
  if (startExcluding && compareVersions(installedVersion, startExcluding) <= 0) return false;
  if (endIncluding && compareVersions(installedVersion, endIncluding) > 0) return false;
  if (endExcluding && compareVersions(installedVersion, endExcluding) >= 0) return false;
  return true;
}

function rangeLabel(match: CpeMatch, criteriaVersion: string | null) {
  const labels: string[] = [];
  const startIncluding = string(match.versionStartIncluding), startExcluding = string(match.versionStartExcluding);
  const endIncluding = string(match.versionEndIncluding), endExcluding = string(match.versionEndExcluding);
  if (startIncluding) labels.push(`>= ${startIncluding}`);
  if (startExcluding) labels.push(`> ${startExcluding}`);
  if (endIncluding) labels.push(`<= ${endIncluding}`);
  if (endExcluding) labels.push(`< ${endExcluding}`);
  if (labels.length) return labels.join(', ');
  if (criteriaVersion && criteriaVersion !== '*' && criteriaVersion !== '-') return `= ${unescapeCpe(criteriaVersion)}`;
  return 'all versions';
}

function appliesToWindows(configuration: unknown) {
  const matches = collectMatches(configuration);
  const operatingSystems = matches.map(match => string(match.criteria)).filter((value): value is string => !!value)
    .map(cpeParts).filter((value): value is NonNullable<ReturnType<typeof cpeParts>> => !!value).filter(parts => parts.part === 'o');
  if (!operatingSystems.length) return true;
  return operatingSystems.some(parts => `${parts.vendor}:${parts.product}`.includes('windows'));
}

export function matchedRanges(cve: NvdCve, mapping: SecurityMapping, installedVersion: string) {
  if (!Array.isArray(cve.configurations)) return null;
  const ranges = new Set<string>();
  for (const configuration of cve.configurations) {
    if (!appliesToWindows(configuration)) continue;
    for (const match of collectMatches(configuration)) {
      if (match.vulnerable !== true) continue;
      const criteria = string(match.criteria);
      if (!criteria) continue;
      const parts = cpeParts(criteria);
      if (!parts || parts.vendor !== mapping.vendor.toLowerCase() || parts.product !== mapping.product.toLowerCase()) continue;
      if (!versionMatch(match, installedVersion)) continue;
      ranges.add(rangeLabel(match, parts.version));
    }
  }
  return ranges.size ? [...ranges] : null;
}

function severity(cve: NvdCve) {
  const metrics = cve.metrics && typeof cve.metrics === 'object' ? cve.metrics as Record<string, unknown> : {};
  for (const key of ['cvssMetricV40', 'cvssMetricV31', 'cvssMetricV30', 'cvssMetricV2']) {
    const values = metrics[key];
    if (!Array.isArray(values) || !values.length) continue;
    const metric = (values.find(value => value && typeof value === 'object' && (value as Record<string, unknown>).type === 'Primary') ?? values[0]) as Record<string, unknown>;
    const data = metric.cvssData && typeof metric.cvssData === 'object' ? metric.cvssData as Record<string, unknown> : {};
    return {
      score: number(data.baseScore),
      severity: string(data.baseSeverity) ?? string(metric.baseSeverity) ?? 'Unknown',
      version: string(data.version) ?? key,
    };
  }
  return { score: null, severity: 'Unknown', version: null };
}

function description(cve: NvdCve) {
  if (!Array.isArray(cve.descriptions)) return 'No English description was published.';
  const english = cve.descriptions.find(value => value && typeof value === 'object' && (value as Record<string, unknown>).lang === 'en') as Record<string, unknown> | undefined;
  return string(english?.value) ?? string((cve.descriptions[0] as Record<string, unknown> | undefined)?.value) ?? 'No description was published.';
}

function finding(cve: NvdCve, ranges: string[]): Finding | null {
  const id = string(cve.id);
  if (!id) return null;
  const cvss = severity(cve);
  return { cveId: id, description: description(cve), severity: cvss.severity, score: cvss.score, cvssVersion: cvss.version,
    published: string(cve.published), lastModified: string(cve.lastModified), matchedRanges: ranges,
    url: `https://nvd.nist.gov/vuln/detail/${encodeURIComponent(id)}` };
}

export async function readSecurity(db: PrismaClient, deviceKey: string) {
  const snapshot = await db.inventorySnapshot.findFirst({
    where: { device: { key: deviceKey } }, orderBy: { scannedAt: 'desc' },
    select: { id: true, scannedAt: true, device: { select: { name: true } },
      packages: { orderBy: { name: 'asc' }, select: { id: true, name: true, packageId: true, installedVersion: true } } },
  });
  if (!snapshot) return { state: 'empty' as const };
  const rows: SecurityFindingRow[] = [];
  let mapped = 0, packagesWithFindings = 0, unavailable = 0, truncatedProducts = 0;
  for (const pkg of snapshot.packages) {
    const mapping = securityMappingFor(pkg.packageId);
    const normalizedVersion = normalizeInstalledVersion(pkg.installedVersion);
    if (!mapping) {
      rows.push({ id: pkg.id, name: pkg.name, packageId: pkg.packageId, installedVersion: pkg.installedVersion,
        normalizedVersion, mappingStatus: 'unmapped', status: 'unmapped', mapping: null, findings: [] });
      continue;
    }
    if (!normalizedVersion) {
      rows.push({ id: pkg.id, name: pkg.name, packageId: pkg.packageId, installedVersion: pkg.installedVersion,
        normalizedVersion, mappingStatus: 'unparseable', status: 'unparseable',
        mapping: { vendor: mapping.vendor, product: mapping.product }, findings: [] });
      continue;
    }
    mapped++;
    try {
      const entry = await productCves(mapping);
      const findings = entry.cves.flatMap(cve => {
        const ranges = matchedRanges(cve, mapping, normalizedVersion);
        const value = ranges ? finding(cve, ranges) : null;
        return value ? [value] : [];
      }).filter((value, index, all) => all.findIndex(other => other.cveId === value.cveId) === index)
        .sort((left, right) => (right.score ?? -1) - (left.score ?? -1) || left.cveId.localeCompare(right.cveId));
      if (entry.truncated) truncatedProducts++;
      if (findings.length) packagesWithFindings++;
      rows.push({ id: pkg.id, name: pkg.name, packageId: pkg.packageId, installedVersion: pkg.installedVersion,
        normalizedVersion, mappingStatus: 'mapped', status: findings.length ? 'findings' : 'none',
        mapping: { vendor: mapping.vendor, product: mapping.product }, findings,
        ...(entry.truncated ? { note: 'NVD returned more results than the local safety limit. Findings are incomplete.' } : {}) });
    } catch {
      unavailable++;
      rows.push({ id: pkg.id, name: pkg.name, packageId: pkg.packageId, installedVersion: pkg.installedVersion,
        normalizedVersion, mappingStatus: 'mapped', status: 'unavailable',
        mapping: { vendor: mapping.vendor, product: mapping.product }, findings: [],
        error: 'No verified finding available. The NVD query was unavailable.' });
    }
  }
  const order: Record<string, number> = { findings: 0, none: 1, unavailable: 2, unparseable: 3, unmapped: 4 };
  rows.sort((left, right) => order[left.status] - order[right.status] || left.name.localeCompare(right.name));
  return { state: 'ready' as const, deviceName: snapshot.device.name, snapshotId: snapshot.id, scannedAt: snapshot.scannedAt,
    checkedAt: new Date().toISOString(), nvdApiKeyConfigured: !!process.env.NVD_API_KEY,
    summary: { packages: snapshot.packages.length, mapped, packagesWithFindings, unavailable, truncatedProducts,
      unmapped: rows.filter(row => row.status === 'unmapped').length,
      unparseable: rows.filter(row => row.status === 'unparseable').length,
      findings: rows.reduce((total, row) => total + row.findings.length, 0) },
    rows };
}
