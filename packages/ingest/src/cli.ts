import { getPool } from "@sweeptrack/db";
import { refreshSweepstakes, runSource, runTick, seedSources } from "./index";

const [cmd, arg] = process.argv.slice(2);
try {
  switch (cmd) {
    case "seed-sources":
      console.log(`Inserted ${await seedSources()} source(s)`);
      break;
    case "run":
      if (!arg) throw new Error("usage: run <sourceId>");
      console.log(await runSource(arg));
      break;
    case "refresh":
      if (!arg) throw new Error("usage: refresh <sweepstakesId>");
      await refreshSweepstakes(arg);
      break;
    case "tick":
      console.log(JSON.stringify(await runTick(Number(arg) || 240_000), null, 2));
      break;
    default:
      console.log("usage: pnpm ingest <seed-sources | run <sourceId> | refresh <id> | tick [budgetMs]>");
  }
} finally {
  await getPool().end();
}
