import { readFile, stat } from "node:fs/promises";
import { parseArgs } from "node:util";
import { Prisma } from "../generated/prisma/client.js";
import { createDatabase } from "./database.js";
import { contentHash, parseSnapshot } from "./inventory.js";

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { file: { type: "string" }, "device-key": { type: "string" }, "device-name": { type: "string" } },
  });
  const command = positionals[0];
  if (positionals.length !== 1 || !["check", "import", "summary"].includes(command ?? ""))
    throw new Error("Use db:check, db:import -- --file PATH --device-key KEY --device-name NAME, or db:summary -- --device-key KEY.");
  const key = values["device-key"];
  if (command !== "check" && (!key || !/^[a-zA-Z0-9_-]{1,100}$/.test(key)))
    throw new Error("Supply a stable --device-key using 1–100 letters, numbers, underscores, or hyphens.");

  // Validate input before opening a database connection.
  let snapshot;
  if (command === "import") {
    if (!values.file || !values["device-name"]?.trim() || values["device-name"].length > 200)
      throw new Error("Import requires --file and a --device-name of 1–200 characters.");
    const info = await stat(values.file);
    if (!info.isFile() || info.size > 20 * 1024 * 1024) throw new Error("Snapshot must be a JSON file no larger than 20 MB.");
    snapshot = parseSnapshot(await readFile(values.file, "utf8"));
  }

  const db = createDatabase();
  try {
    if (command === "check") {
      const result = await db.$queryRaw<Array<{ database: string; user: string }>>`
        SELECT current_database() AS database, current_user AS "user"
      `;
      console.log("PostgreSQL connection successful:", result[0]);
      return;
    }
    if (command === "import" && snapshot) {
      const input = snapshot;
      const hash = contentHash(input);
      const result = await db.$transaction(async tx => {
        const device = await tx.device.upsert({
          where: { key: key! },
          create: { key: key!, name: values["device-name"]!.trim() },
          update: {},
        });
        const existing = await tx.inventorySnapshot.findUnique({ where: { deviceId_contentHash: { deviceId: device.id, contentHash: hash } } });
        if (existing) return { id: existing.id, alreadyImported: true };
        const saved = await tx.inventorySnapshot.create({ data: {
          deviceId: device.id, scannedAt: new Date(input.scannedAt), contentHash: hash,
          wingetStatus: input.winget.status,
          warnings: input.warnings,
          raw: input as Prisma.InputJsonValue,
          applications: { create: input.applications },
          packages: { create: input.winget.status === "completed" ? input.winget.inventory.packages.map(({ id, ...pkg }) => ({ ...pkg, packageId: id })) : [] },
        } });
        return { id: saved.id, alreadyImported: false };
      }, { timeout: 30000 });
      console.log(result.alreadyImported ? "Snapshot already imported; no duplicate created." : "Snapshot imported successfully.");
      console.log("Snapshot ID:", result.id);
      return;
    }
    const latest = await db.inventorySnapshot.findFirst({
      where: { device: { key } }, orderBy: { scannedAt: "desc" },
      include: { _count: { select: { applications: true, packages: true } } },
    });
    if (!latest) { console.log("No stored scans for this device."); return; }
    const updates = latest.wingetStatus === "completed"
      ? await db.winGetPackage.count({ where: { snapshotId: latest.id, isUpdateAvailable: true, matchStatus: "matched" } }) : null;
    console.log(JSON.stringify({ snapshotId: latest.id, scannedAt: latest.scannedAt,
      registryEntries: latest._count.applications, wingetStatus: latest.wingetStatus,
      wingetEntries: latest.wingetStatus === "completed" ? latest._count.packages : null,
      updatesAvailable: updates }, null, 2));
  } finally { await db.$disconnect(); }
}

main().catch(error => {
  // Do not print connection URLs, credentials, full inventory, or Prisma query arguments.
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    console.error(`Database operation failed (${error.code}). Check migrations, constraints, and connection settings. No partial snapshot was imported.`);
  } else if (error?.name === "ZodError" || error instanceof SyntaxError) {
    console.error("Invalid agent snapshot. Check the schema version and run a fresh scan with the current agent.");
  } else {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(message.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[redacted connection URL]"));
  }
  process.exitCode = 1;
});
