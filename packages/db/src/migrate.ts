import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import { db, getPool } from "./client";

const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));
await migrate(db, { migrationsFolder });
console.log("Migrations applied");
await getPool().end();
