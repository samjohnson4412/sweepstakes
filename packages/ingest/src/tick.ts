import { and, db, eq, gt, isNull, lt, or, sql, sweepstakes, trackedSweepstakes } from "@sweeptrack/db";
import { refreshSweepstakes } from "./catalog";
import { enqueue, pruneJobs, runJobs, type JobHandler } from "./jobs";
import { syncDueMailAccounts } from "./mail";
import { importLinkJob } from "./newsletter";
import { runDueSources, runSource } from "./pipeline";

export const JOB_HANDLERS: Record<string, JobHandler> = {
  "import-link": importLinkJob,
  refresh: async (p) => refreshSweepstakes(String(p.sweepstakesId)),
  "run-source": async (p) => void (await runSource(String(p.sourceId))),
};

/** Queue re-crawls for active, tracked sweepstakes not checked in 3 days. */
async function queueStaleRefreshes(limit = 20): Promise<number> {
  const rows = await db
    .selectDistinct({ id: sweepstakes.id })
    .from(sweepstakes)
    .innerJoin(trackedSweepstakes, and(eq(trackedSweepstakes.sweepstakesId, sweepstakes.id), eq(trackedSweepstakes.status, "active")))
    .where(
      and(
        isNull(sweepstakes.humanEditedAt),
        or(isNull(sweepstakes.endsAt), gt(sweepstakes.endsAt, new Date())),
        or(isNull(sweepstakes.lastCrawledAt), lt(sweepstakes.lastCrawledAt, sql`now() - interval '3 days'`)),
      ),
    )
    .limit(limit);
  for (const r of rows) {
    await db.update(sweepstakes).set({ lastCrawledAt: new Date() }).where(eq(sweepstakes.id, r.id));
    await enqueue("refresh", { sweepstakesId: r.id });
  }
  return rows.length;
}

/**
 * One scheduler tick (Cloud Scheduler hits /api/cron/tick every ~10 minutes). Each
 * stage gets a slice of the time budget so a slow site can't starve the others.
 */
export async function runTick(budgetMs = 240_000) {
  const start = Date.now();
  const slice = (fraction: number) => start + budgetMs * fraction;
  const mail = await syncDueMailAccounts(slice(0.2));
  const refreshQueued = await queueStaleRefreshes();
  const jobs = await runJobs(JOB_HANDLERS, Math.max(0, slice(0.55) - Date.now()));
  const sourcesRun = await runDueSources(slice(1));
  await pruneJobs();
  return { mailStored: mail, refreshQueued, jobs, sources: sourcesRun, ms: Date.now() - start };
}
