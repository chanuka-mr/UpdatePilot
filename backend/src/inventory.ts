import { createHash } from "node:crypto";
import { z } from "zod";

const text = z.string().min(1).max(4096);
const application = z.object({
  name: text,
  installedVersion: z.string().max(4096).nullable(),
  publisher: z.string().max(4096).nullable(),
  scope: z.enum(["machine", "user"]),
  registryView: z.enum(["Registry32", "Registry64"]),
  registryPath: text,
  discoverySource: z.literal("uninstall-registry"),
  matchStatus: z.literal("unmatched"),
});
const packageRecord = z.object({
  name: text,
  id: text,
  installedVersion: z.string().max(4096).nullable(),
  source: z.string().max(4096).nullable(),
  isUpdateAvailable: z.boolean(),
  availableVersions: z.array(text).max(10000),
  matchStatus: z.enum(["matched", "unmatched"]),
}).superRefine((pkg, context) => {
  const matched = pkg.source?.toLowerCase() === "winget";
  if (pkg.source?.trim() && !matched)
    context.addIssue({ code: "custom", message: "Unexpected package source" });
  if (pkg.matchStatus !== (matched ? "matched" : "unmatched"))
    context.addIssue({ code: "custom", message: "Match status disagrees with source" });
  if (pkg.isUpdateAvailable && !matched)
    context.addIssue({ code: "custom", message: "Update candidate requires a catalog match" });
});
const inventory = z.object({
  schemaVersion: z.literal(1),
  scannedAt: z.iso.datetime({ offset: true }),
  moduleVersion: text,
  packages: z.array(packageRecord).max(20000),
});
export const snapshotSchema = z.object({
  schemaVersion: z.literal(2),
  scannedAt: z.iso.datetime({ offset: true }),
  applications: z.array(application).max(20000),
  warnings: z.array(z.string().max(16384)).max(10000),
  winget: z.discriminatedUnion("status", [
    z.object({ status: z.literal("completed"), inventory, error: z.null() }),
    z.object({ status: z.literal("failed"), inventory: z.null(), error: text }),
    z.object({ status: z.literal("not-requested"), inventory: z.null(), error: z.null() }),
  ]),
}).superRefine((snapshot, context) => {
  const registrations = new Set<string>();
  for (const app of snapshot.applications) {
    const key = JSON.stringify([app.scope, app.registryView, app.registryPath]);
    if (registrations.has(key)) context.addIssue({ code: "custom", message: "Duplicate registry registration" });
    registrations.add(key);
  }
});
export type Snapshot = z.infer<typeof snapshotSchema>;

export function parseSnapshot(raw: string): Snapshot {
  return snapshotSchema.parse(JSON.parse(raw));
}

export function contentHash(snapshot: Snapshot): string {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}
