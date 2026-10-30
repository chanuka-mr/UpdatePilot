import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

export function createDatabase() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString || connectionString.includes("REPLACE_WITH"))
    throw new Error("Set DATABASE_URL in backend/.env using your local PostgreSQL credentials.");
  const url = new URL(connectionString);
  if (!["postgresql:", "postgres:"].includes(url.protocol))
    throw new Error("DATABASE_URL must be a PostgreSQL connection URL.");
  const adapter = new PrismaPg({ connectionString, max: 3, connectionTimeoutMillis: 5000 });
  return new PrismaClient({ adapter });
}
