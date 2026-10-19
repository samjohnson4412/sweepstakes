import Link from "next/link";
import { amoeEntries, db, entrantProfiles, eq, inArray, sql, sweepstakes, users } from "@sweeptrack/db";
import { mailServiceEnabled, requireAdmin } from "@/lib/admin";
import { fmtDate, relDays } from "@/lib/format";
import { reviewAmoe, setServiceStatus } from "../../actions";

export const dynamic = "force-dynamic";

export default async function AdminMailPage() {
  await requireAdmin();
  const rows = await db
    .select({ a: amoeEntries, s: sweepstakes, firstName: entrantProfiles.firstName, lastName: entrantProfiles.lastName, email: users.email })
    .from(amoeEntries)
    .innerJoin(sweepstakes, eq(sweepstakes.id, amoeEntries.sweepstakesId))
    .innerJoin(entrantProfiles, eq(entrantProfiles.id, amoeEntries.profileId))
    .innerJoin(users, eq(users.id, amoeEntries.userId))
    .where(inArray(amoeEntries.serviceStatus, ["pending_review", "queued", "printed"]))
    .orderBy(sql`${amoeEntries.mailBy} asc nulls last`);

  const pending = new Map<string, { s: (typeof rows)[number]["s"]; count: number }>();
  for (const r of rows.filter((r) => r.a.serviceStatus === "pending_review")) {
    pending.set(r.s.id, { s: r.s, count: (pending.get(r.s.id)?.count ?? 0) + 1 });
  }
  const queued = rows.filter((r) => r.a.serviceStatus === "queued");
  const printed = rows.filter((r) => r.a.serviceStatus === "printed");

  return (
    <div>
      <p className="small">
        <Link href="/admin">← Admin</Link>
      </p>
      <h1>Mail-in service</h1>
      {!mailServiceEnabled() && (
        <div className="notice warn">The service is off (MAIL_SERVICE_ENABLED is not &quot;true&quot;), so users can&apos;t request it.</div>
      )}
      <div className="notice small">
        Approve a sweepstakes only after reading its official rules: they must allow entries mailed by a third party, and
        must not require hand-printing by the entrant or ban mechanically reproduced entries. Get legal sign-off before
        launching this service.
      </div>

      <h2>Needs rules review ({pending.size})</h2>
      {pending.size === 0 && <p className="muted">Nothing to review.</p>}
      <div className="stack">
        {[...pending.values()].map(({ s, count }) => (
          <div key={s.id} className="card stack">
            <div className="row">
              <Link href={`/sweepstakes/${s.id}`}>{s.title}</Link>
              <span className="muted small">{count} request(s)</span>
              {s.rulesUrl && (
                <a href={s.rulesUrl} target="_blank" rel="noopener noreferrer" className="small">
                  Official rules ↗
                </a>
              )}
            </div>
            <div className="small">
              Parsed: third-party entries <strong>{s.amoe?.thirdPartyAllowed ?? "unknown"}</strong>, hand-print{" "}
              <strong>{s.amoe?.handwrittenRequired ? "required" : "not detected"}</strong>, mechanical reproduction{" "}
              <strong>{s.amoe?.mechanicalReproductionAllowed ?? "unknown"}</strong>
            </div>
            <form action={reviewAmoe} className="row">
              <input type="hidden" name="sweepstakesId" value={s.id} />
              <input name="note" placeholder="Note (rule section, reason)" style={{ flex: 1 }} />
              <button name="decision" value="approved" className="small">
                Approve
              </button>
              <button name="decision" value="rejected" className="small secondary">
                Reject
              </button>
            </form>
          </div>
        ))}
      </div>

      {[
        { title: "Queued to print", list: queued, next: "printed", label: "Mark printed" },
        { title: "Printed, awaiting mailing", list: printed, next: "mailed", label: "Mark mailed" },
      ].map(({ title, list, next, label }) => (
        <section key={title}>
          <h2>
            {title} ({list.length})
          </h2>
          {list.length > 0 && (
            <form action={setServiceStatus} className="stack">
              <input type="hidden" name="status" value={next} />
              <table>
                <thead>
                  <tr>
                    <th></th>
                    <th>Sweepstakes</th>
                    <th>Entrant</th>
                    <th>Mail by</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map(({ a, s, firstName, lastName, email }) => (
                    <tr key={a.id}>
                      <td>
                        <input type="checkbox" name="id" value={a.id} defaultChecked aria-label="Select" />
                      </td>
                      <td>{s.title}</td>
                      <td>
                        {firstName} {lastName} <span className="muted small">{email}</span>
                      </td>
                      <td>
                        {fmtDate(a.mailBy)} <span className="muted small">{relDays(a.mailBy)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="row">
                {next === "printed" && (
                  <a className="button secondary" href={`/admin/mail/print?${list.map((r) => `id=${r.a.id}`).join("&")}`} target="_blank">
                    Print all
                  </a>
                )}
                <button>{label}</button>
              </div>
            </form>
          )}
        </section>
      ))}
    </div>
  );
}
