import Link from "next/link";
import { db, desc, eq, jobs, sources, sql, sweepstakes } from "@sweeptrack/db";
import { catalogInboxAddress } from "@sweeptrack/ingest";
import { ActionForm } from "@/components/ActionForm";
import { requireAdmin } from "@/lib/admin";
import { fmtDateTime } from "@/lib/format";
import { addSource, runSourceNow, updateSource } from "../actions";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  await requireAdmin();
  const [rows, counts, failed, [catalog]] = await Promise.all([
    db
      .select({ s: sources, items: sql<number>`(select count(*)::int from sweepstakes_sources ss where ss.source_id = ${sources.id})` })
      .from(sources)
      .orderBy(sources.id),
    db.select({ status: jobs.status, n: sql<number>`count(*)::int` }).from(jobs).groupBy(jobs.status),
    db.select().from(jobs).where(eq(jobs.status, "failed")).orderBy(desc(jobs.updatedAt)).limit(10),
    db
      .select({
        total: sql<number>`count(*)::int`,
        open: sql<number>`count(*) filter (where ${sweepstakes.endsAt} is null or ${sweepstakes.endsAt} > now())::int`,
        week: sql<number>`count(*) filter (where ${sweepstakes.createdAt} > now() - interval '7 days')::int`,
      })
      .from(sweepstakes),
  ]);
  const jobCount = (s: string) => counts.find((c) => c.status === s)?.n ?? 0;

  return (
    <div>
      <h1>Admin</h1>
      <p>
        <Link href="/admin/mail">Mail-in service queue →</Link>
      </p>
      <div className="grid">
        <div className="card">
          <div className="muted small">Catalog (open / total)</div>
          <div className="stat">
            {catalog?.open ?? 0} / {catalog?.total ?? 0}
          </div>
          <div className="small muted">{catalog?.week ?? 0} added in the last 7 days</div>
        </div>
        <div className="card">
          <div className="muted small">Jobs queued / failed</div>
          <div className="stat">
            {jobCount("queued")} / {jobCount("failed")}
          </div>
        </div>
        <div className="card small">
          <div className="muted">Newsletter inbox</div>
          Subscribe <code>{catalogInboxAddress()}</code> to sweepstakes newsletters; their links are imported automatically.
        </div>
      </div>

      <h2>Catalog sources</h2>
      <div className="stack">
        {rows.map(({ s, items }) => (
          <div key={s.id} className="card stack">
            <div className="row">
              <strong>{s.name}</strong> <code className="small">{s.id}</code>
              <span className={`badge ${s.lastStatus === "ok" ? "good" : s.lastStatus === "error" ? "bad" : ""}`}>{s.lastStatus ?? "never run"}</span>
              <span className="muted small">
                {items} items · last run {fmtDateTime(s.lastRunAt)}
                {s.lastItemCount !== null && ` (${s.lastItemCount} new/updated)`}
              </span>
            </div>
            {s.url && <div className="mono small muted" style={{ wordBreak: "break-all" }}>{s.url}</div>}
            {s.lastError && <div className="notice error small">{s.lastError}</div>}
            {s.kind !== "newsletter" && (
              <div className="row">
                <form action={updateSource} className="row">
                  <input type="hidden" name="id" value={s.id} />
                  <label className="check">
                    <input type="checkbox" name="enabled" defaultChecked={s.enabled} /> Enabled
                  </label>
                  <label className="check">
                    <input type="checkbox" name="respectRobots" defaultChecked={s.respectRobots} /> Honor robots.txt
                  </label>
                  <label className="check">
                    <input type="checkbox" name="followSponsor" defaultChecked={s.followSponsor} /> Read sponsor rules
                  </label>
                  <label className="check">
                    Every <input name="intervalMinutes" type="number" min="30" defaultValue={s.intervalMinutes} style={{ width: 80 }} /> min
                  </label>
                  <label className="check">
                    Max <input name="maxItemsPerRun" type="number" min="1" max="200" defaultValue={s.maxItemsPerRun} style={{ width: 70 }} /> items/run
                  </label>
                  <button className="small secondary">Save</button>
                </form>
                <form action={runSourceNow}>
                  <input type="hidden" name="id" value={s.id} />
                  <button className="small">Run now</button>
                </form>
              </div>
            )}
          </div>
        ))}
      </div>

      <h2>Add a feed or sitemap</h2>
      <div className="card">
        <ActionForm action={addSource} submitLabel="Add source">
          <div className="fields">
            <label>
              Id
              <input name="id" placeholder="my-sweeps-blog" required />
            </label>
            <label>
              Name
              <input name="name" required />
            </label>
            <label>
              Type
              <select name="kind">
                <option value="rss">RSS / Atom feed</option>
                <option value="sitemap">Sitemap</option>
              </select>
            </label>
            <label style={{ gridColumn: "span 2" }}>
              URL
              <input name="url" type="url" required />
            </label>
          </div>
        </ActionForm>
      </div>

      {failed.length > 0 && (
        <>
          <h2>Recent failed jobs</h2>
          <table>
            <thead>
              <tr>
                <th>Kind</th>
                <th>Payload</th>
                <th>Error</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {failed.map((j) => (
                <tr key={j.id}>
                  <td>{j.kind}</td>
                  <td className="mono small" style={{ wordBreak: "break-all" }}>{JSON.stringify(j.payload).slice(0, 120)}</td>
                  <td className="small">{j.lastError}</td>
                  <td className="small">{fmtDateTime(j.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
