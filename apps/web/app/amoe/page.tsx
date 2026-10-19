import Link from "next/link";
import { amoeEntries, and, db, entrantProfiles, eq, gte, sql, sweepstakes } from "@sweeptrack/db";
import { requireUser } from "@/lib/auth";
import { fmtDate, money, relDays } from "@/lib/format";
import { mailServiceEnabled } from "@/lib/admin";
import { cancelMailService, requestMailService, setAmoeStatus } from "../actions";

export const dynamic = "force-dynamic";

const STATUSES = ["planned", "prepared", "mailed", "confirmed", "skipped"] as const;

/** Monday (UTC) of the week containing a YYYY-MM-DD date. */
function weekOf(d: string | null): string {
  if (!d) return "No deadline";
  const date = new Date(`${d}T12:00:00Z`);
  const monday = new Date(date.getTime() - ((date.getUTCDay() + 6) % 7) * 86_400_000);
  return `Week of ${fmtDate(monday.toISOString().slice(0, 10))}`;
}

export default async function AmoePage() {
  const user = await requireUser();
  const startOfYear = `${new Date().getUTCFullYear()}-01-01`;
  const [rows, [spend]] = await Promise.all([
    db
      .select({
        a: amoeEntries,
        title: sweepstakes.title,
        sweepstakesId: sweepstakes.id,
        firstName: entrantProfiles.firstName,
        amoe: sweepstakes.amoe,
        amoeReview: sweepstakes.amoeReview,
      })
      .from(amoeEntries)
      .innerJoin(sweepstakes, eq(sweepstakes.id, amoeEntries.sweepstakesId))
      .innerJoin(entrantProfiles, eq(entrantProfiles.id, amoeEntries.profileId))
      .where(and(eq(amoeEntries.userId, user.id), sql`${amoeEntries.status} in ('planned','prepared')`))
      .orderBy(sql`${amoeEntries.mailBy} asc nulls last`),
    db
      .select({ cents: sql<number>`coalesce(sum(${amoeEntries.postageCents}), 0)::int`, n: sql<number>`count(*)::int` })
      .from(amoeEntries)
      .where(and(eq(amoeEntries.userId, user.id), sql`${amoeEntries.status} in ('mailed','confirmed')`, gte(amoeEntries.mailedAt, new Date(startOfYear)))),
  ]);

  const service = mailServiceEnabled();
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = weekOf(r.a.mailBy);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  return (
    <div>
      <h1>Mail-in batch planner</h1>
      <div className="grid">
        <div className="card">
          <div className="muted small">To prepare & mail</div>
          <div className="stat">{rows.length}</div>
        </div>
        <div className="card">
          <div className="muted small">Mailed this year</div>
          <div className="stat">{spend?.n ?? 0}</div>
        </div>
        <div className="card">
          <div className="muted small">Postage spent this year</div>
          <div className="stat">{money(spend?.cents ?? 0)}</div>
        </div>
      </div>

      <form id="print" action="/amoe/print" method="get" target="_blank" />
      {rows.length === 0 ? (
        <div className="card empty" style={{ marginTop: 16 }}>
          No mail-in entries planned. Open a sweepstakes with a mail-in method and click “Plan mail-in entry”.
        </div>
      ) : (
        <>
          {[...groups.entries()].map(([week, items]) => (
            <section key={week}>
              <h2>{week}</h2>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Print</th>
                      <th>Sweepstakes</th>
                      <th>Entrant</th>
                      <th>Mail by</th>
                      <th>Deadline</th>
                      <th>Postage</th>
                      <th>Status</th>
                      {service && <th>Mail service</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(({ a, title, sweepstakesId, firstName, amoe, amoeReview }) => (
                      <tr key={a.id}>
                        <td>
                          <input type="checkbox" name="id" value={a.id} form="print" defaultChecked aria-label="Include in print batch" />
                        </td>
                        <td>
                          <Link href={`/sweepstakes/${sweepstakesId}`}>{title}</Link>
                        </td>
                        <td>{firstName}</td>
                        <td>
                          {fmtDate(a.mailBy)} <span className="muted small">{relDays(a.mailBy)}</span>
                        </td>
                        <td className="small">
                          {fmtDate(a.deadline)} <span className="muted">{a.deadlineType.replace("_", " ")}</span>
                        </td>
                        <td>{money(a.postageCents)}</td>
                        <td>
                          <form action={setAmoeStatus} className="row">
                            <input type="hidden" name="id" value={a.id} />
                            <select name="status" defaultValue={a.status}>
                              {STATUSES.map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </select>
                            <button className="small secondary">Save</button>
                          </form>
                        </td>
                        {service && (
                          <td className="small">
                            {a.fulfilledBy === "service" ? (
                              <div className="row">
                                <span className="badge">{a.serviceStatus?.replace("_", " ")}</span>
                                {(a.serviceStatus === "pending_review" || a.serviceStatus === "queued") && (
                                  <form action={cancelMailService}>
                                    <input type="hidden" name="id" value={a.id} />
                                    <button className="small secondary">Cancel</button>
                                  </form>
                                )}
                              </div>
                            ) : amoe?.thirdPartyAllowed === "no" || amoeReview === "rejected" ? (
                              <span className="muted">Rules require you to mail it yourself</span>
                            ) : a.status === "planned" ? (
                              <form action={requestMailService} className="stack">
                                <input type="hidden" name="id" value={a.id} />
                                <label className="check">
                                  <input type="checkbox" name="authorize" required /> I authorize SweepTrack to prepare and mail this entry for me
                                </label>
                                <button className="small secondary">Request</button>
                              </form>
                            ) : null}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
          <p style={{ marginTop: 16 }}>
            <button form="print">Print cards & envelopes for selected</button>
          </p>
        </>
      )}
      <p className="small muted" style={{ marginTop: 24 }}>
        Mail-by dates allow 5 business days of USPS transit for “received by” deadlines. Many rules require hand-printed
        entries and prohibit mechanically reproduced ones; use the printed cards as a template when that applies.
      </p>
    </div>
  );
}
