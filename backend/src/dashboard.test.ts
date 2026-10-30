import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizePackages, type PackageSummary } from "./dashboard.js";
const base: PackageSummary = { id: "1", name: "Example", packageId: "Example.App", installedVersion: "1", source: "winget", isUpdateAvailable: true, matchStatus: "matched" };
test("counts only source-matched updates and does not count unmatched entries as current", () => {
  const result = summarizePackages("completed", [base, { ...base, id: "2", isUpdateAvailable: false }, { ...base, id: "3", source: "", matchStatus: "unmatched", isUpdateAvailable: false }]);
  assert.equal(result.updatesAvailable, 1); assert.equal(result.matchedWithoutKnownUpdates, 1);
  assert.equal(result.unmatched, 1); assert.equal(result.wingetEntries, 3);
});
test("failed/unrequested catalogs return unknown counts, not zero", () => {
  for (const state of ["failed", "not-requested"]) {
    const result = summarizePackages(state, [base]);
    assert.equal(result.updatesAvailable, null); assert.equal(result.wingetEntries, null);
    assert.deepEqual(result.updatePreview, []);
  }
});
test("completed empty catalogs have known zero counts", () => assert.equal(summarizePackages("completed", []).updatesAvailable, 0));
test("preview is capped, sorted, and never suggests an unverified target version", () => {
  const result = summarizePackages("completed", Array.from({ length: 8 }, (_, i) => ({ ...base, id: String(i), name: `App ${8-i}` })));
  assert.equal(result.updatePreview.length, 5); assert.equal(result.updatesAvailable, 8);
  assert.equal(result.updatePreview[0].name, "App 1"); assert.equal("latest" in result.updatePreview[0], false);
});
