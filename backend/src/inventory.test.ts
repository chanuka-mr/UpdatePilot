import assert from "node:assert/strict";
import { test } from "node:test";
import { contentHash, parseSnapshot } from "./inventory.js";

function sample() {
  return {
    schemaVersion: 2, scannedAt: "2026-10-30T10:00:00.1234567+00:00",
    applications: [{ name: "Example", installedVersion: "1.0", publisher: null,
      scope: "user", registryView: "Registry64", registryPath: "CurrentUser\\Example",
      discoverySource: "uninstall-registry", matchStatus: "unmatched" }],
    warnings: [],
    winget: { status: "completed", error: null, inventory: {
      schemaVersion: 1, scannedAt: "2026-10-30T10:00:00Z", moduleVersion: "1.0",
      packages: [
        { name: "AnyDesk", id: "AnyDesk.AnyDesk", installedVersion: "ad 9.7.13", source: "winget",
          isUpdateAvailable: true, availableVersions: ["9.8.3", "9.8.2"], matchStatus: "matched" },
        { name: "Unmatched", id: "ARP\\Example", installedVersion: null, source: "",
          isUpdateAvailable: false, availableVersions: [], matchStatus: "unmatched" },
      ],
    } },
  };
}

test("accepts .NET timestamps and preserves non-semantic versions and unmatched packages", () => {
  const result = parseSnapshot(JSON.stringify(sample()));
  assert.equal(result.winget.status, "completed");
  if (result.winget.status !== "completed") return;
  assert.equal(result.winget.inventory.packages[0].installedVersion, "ad 9.7.13");
  assert.equal(result.winget.inventory.packages[1].matchStatus, "unmatched");
});
test("hash is stable across JSON formatting and key ordering", () => {
  const value = sample();
  const { winget, ...rest } = value;
  assert.equal(contentHash(parseSnapshot(JSON.stringify(value))),
    contentHash(parseSnapshot(JSON.stringify({ winget, ...rest }, null, 2))));
});
test("a new scan produces a different snapshot fingerprint", () => {
  const value = sample();
  const original = contentHash(parseSnapshot(JSON.stringify(value)));
  value.scannedAt = "2026-10-30T11:00:00Z";
  assert.notEqual(contentHash(parseSnapshot(JSON.stringify(value))), original);
});
test("rejects update claims without a catalog match", () => {
  const value = sample(); value.winget.inventory.packages[1].isUpdateAvailable = true;
  assert.throws(() => parseSnapshot(JSON.stringify(value)));
});
test("rejects duplicate registry identities without merging names", () => {
  const value = sample(); value.applications.push({ ...value.applications[0], name: "Different name" });
  assert.throws(() => parseSnapshot(JSON.stringify(value)));
});
test("rejects completed scans missing package inventory", () => {
  assert.throws(() => parseSnapshot(JSON.stringify({ ...sample(), winget: { status: "completed", inventory: null, error: null } })));
});
test("retains explicit failed and not-requested states", () => {
  for (const winget of [{ status: "failed", inventory: null, error: "Source unavailable" },
    { status: "not-requested", inventory: null, error: null }]) {
    const result = parseSnapshot(JSON.stringify({ ...sample(), winget }));
    assert.equal(result.winget.status, winget.status);
    assert.equal(result.winget.inventory, null);
  }
});
test("rejects inconsistent sources and unsupported schema versions", () => {
  const value = sample(); value.winget.inventory.packages[0].source = "untrusted";
  assert.throws(() => parseSnapshot(JSON.stringify(value)));
  assert.throws(() => parseSnapshot(JSON.stringify({ ...sample(), schemaVersion: 999 })));
});
