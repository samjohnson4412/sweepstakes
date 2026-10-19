import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __sweeptrackPool?: pg.Pool };

/** Shared pool; reused across Next.js dev hot reloads. */
export function getPool(): pg.Pool {
  globalForDb.__sweeptrackPool ??= new pg.Pool({
    connectionString: process.env.DATABASE_URL ?? "postgres://sweeptrack:sweeptrack@localhost:5432/sweeptrack",
    max: 10,
  });
  return globalForDb.__sweeptrackPool;
}

export const db: Db = drizzle(getPool(), { schema });
