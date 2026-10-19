import Link from "next/link";
import { and, db, eq, ne, sql, sweepstakes, trackedSweepstakes } from "@sweeptrack/db";
import { ActionForm } from "@/components/ActionForm";
import { requireUser } from "@/lib/auth";
import { FREQUENCY_LABEL, fmtDate, money, relDays } from "@/lib/format";
import { addSweepstakes, setTrackedStatus } from "../actions";

export const dynamic = "force-dynamic";

export default async function SweepstakesPage() {
  const user = await requireUser();
  const rows = await db
    .select({
      trackedId: trackedSweepstakes.id,
      status: trackedSweepstakes.status,
      frequency: sql<string>`coalesce(${trackedSweepstakes.frequencyOverride}, ${sweepstakes.frequency})`,
      s: sweepstakes,
    })
    .from(trackedSweepstakes)
    .innerJoin(sweepstakes, eq(sweepstakes.id, trackedSweepstakes.sweepstakesId))
    .where(and(eq(trackedSweepstakes.userId, user.id), ne(trackedSweepstakes.status, "hidden")))
    .orderBy(sql`${sweepstakes.endsAt} asc nulls last`);
  const now = new Date();

  return (
    <div>
      <h1>Sweepstakes</h1>
      <div className="card">
        <ActionForm action={addSweepstakes} submitLabel="Add & parse rules" className="stack">
          <div className="fields">
            <label style={{ gridColumn: "span 2" }}>
              Sweepstakes page URL
              <input name="url" type="url" placeholder="https://brand.com/sweepstakes" required />
            </label>
            <label>
              Title (optional)
              <input name="title" placeholder="Auto-detected from the page" />
            </label>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            We fetch the page and its official rules to detect dates, entry frequency, eligibility, and mail-in (AMOE)
            instructions. You can correct anything afterwards.
          </p>
        </ActionForm>
      </div>

      <h2>Tracking ({rows.length})</h2>
      {rows.length === 0 ? (
        <div className="card empty">Nothing tracked yet. Paste a sweepstakes URL above to start.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Frequency</th>
                <th>Ends</th>
                <th>ARV</th>
                <th>Mail-in</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ trackedId, status, frequency, s }) => {
                const ended = s.endsAt && s.endsAt < now;
                return (
                  <tr key={trackedId}>
                    <td>
                      <Link href={`/sweepstakes/${s.id}`}>{s.title}</Link>
                      {s.sponsor && <div className="muted small">{s.sponsor}</div>}
                    </td>
                    <td>{FREQUENCY_LABEL[frequency] ?? frequency}</td>
                    <td>
                      {fmtDate(s.endsAt)}{" "}
                      {ended ? <span className="badge">ended</span> : <span className="muted small">{relDays(s.endsAt)}</span>}
                    </td>
                    <td>{money(s.totalArvCents)}</td>
                    <td>{s.amoe?.available ? <span className="badge good">AMOE</span> : <span className="muted">—</span>}</td>
                    <td>
                      <form action={setTrackedStatus} className="row">
                        <input type="hidden" name="trackedId" value={trackedId} />
                        <select name="status" defaultValue={status}>
                          <option value="active">Active</option>
                          <option value="paused">Paused</option>
                          <option value="ended">Ended</option>
                          <option value="hidden">Remove</option>
                        </select>
                        <button className="small secondary">Save</button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
