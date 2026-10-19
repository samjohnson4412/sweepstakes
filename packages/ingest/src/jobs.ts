import { and, db, eq, jobs, lt, sql } from "@sweeptrack/db";

export type JobHandler = (payload: Record<string, unknown>) => Promise<void>;

const MAX_ATTEMPTS = 3;

export async function enqueue(kind: string, payload: Record<string, unknown> = {}, runAfter = new Date()): Promise<void> {
  await db.insert(jobs).values({ kind, payload, runAfter });
}

/** Claim the next due job atomically (safe with concurrent workers). */
async function claim(): Promise<typeof jobs.$inferSelect | null> {
  const res = await db.execute<{ id: string }>(sql`
    update ${jobs} set status = 'running', attempts = attempts + 1, updated_at = now()
    where id = (
      select id from ${jobs}
      where status = 'queued' and run_after <= now()
      order by run_after
      limit 1
      for update skip locked
    )
    returning id`);
  const id = res.rows[0]?.id;
  return id ? ((await db.query.jobs.findFirst({ where: eq(jobs.id, id) })) ?? null) : null;
}

/** Run queued jobs until the time budget is used up. */
export async function runJobs(handlers: Record<string, JobHandler>, budgetMs: number): Promise<{ done: number; failed: number }> {
  const deadline = Date.now() + budgetMs;
  // Jobs left "running" by a crashed worker go back in the queue.
  await db
    .update(jobs)
    .set({ status: "queued" })
    .where(and(eq(jobs.status, "running"), lt(jobs.updatedAt, new Date(Date.now() - 15 * 60_000))));

  let done = 0;
  let failed = 0;
  while (Date.now() < deadline) {
    const job = await claim();
    if (!job) break;
    const handler = handlers[job.kind];
    try {
      if (!handler) throw new Error(`No handler for job kind "${job.kind}"`);
      await handler(job.payload);
      await db.update(jobs).set({ status: "done", lastError: null, updatedAt: new Date() }).where(eq(jobs.id, job.id));
      done++;
    } catch (e) {
      const retry = job.attempts < MAX_ATTEMPTS;
      await db
        .update(jobs)
        .set({
          status: retry ? "queued" : "failed",
          lastError: (e as Error).message.slice(0, 1000),
          runAfter: new Date(Date.now() + 2 ** job.attempts * 60_000),
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, job.id));
      failed++;
    }
  }
  return { done, failed };
}

/** Drop finished jobs older than a week. */
export async function pruneJobs(): Promise<void> {
  await db.delete(jobs).where(and(eq(jobs.status, "done"), lt(jobs.updatedAt, new Date(Date.now() - 7 * 86_400_000))));
}
