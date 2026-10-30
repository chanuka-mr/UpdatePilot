export type PackageSummary = { id: string; name: string; packageId: string; installedVersion: string | null; source: string | null; isUpdateAvailable: boolean; matchStatus: string };
export function summarizePackages(status: string, packages: PackageSummary[]) {
  if (status !== "completed") return { wingetEntries: null, matched: null, unmatched: null, updatesAvailable: null, matchedWithoutKnownUpdates: null, updatePreview: [] };
  const matched = packages.filter(pkg => pkg.matchStatus === "matched" && pkg.source?.toLowerCase() === "winget");
  const updates = matched.filter(pkg => pkg.isUpdateAvailable);
  return { wingetEntries: packages.length, matched: matched.length,
    unmatched: packages.length - matched.length, updatesAvailable: updates.length,
    matchedWithoutKnownUpdates: matched.length - updates.length,
    updatePreview: updates.sort((a,b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)).slice(0,5)
      .map(({ id, name, packageId, installedVersion }) => ({ id, name, packageId, installedVersion })) };
}
