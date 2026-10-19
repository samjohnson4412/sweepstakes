import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      INGEST_MIN_HOST_INTERVAL_MS: "0",
      DATABASE_URL: process.env.DATABASE_URL ?? "postgres://sweeptrack:sweeptrack@localhost:5432/sweeptrack",
    },
  },
});
