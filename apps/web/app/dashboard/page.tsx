import Link from "next/link";
import { amoeEntries, and, db, eq, entries, gte, inArray, inboundMessages, lte, sql, sweepstakes, wins } from "@sweeptrack/db";
import { requireUser } from "@/lib/auth";
import { getTrackedRows } from "@/lib/sweeps";
import { fmtDate, fmtDateTime, money, relDays } from "@/lib/format";
import { markEntered } from "../actions";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const user = await requireUser();
  const now = new Date();
  const weekAhead = new Date(now.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
  const startOfYear = `${now.getUTCFullYear()}-01-01`;

  const [rows, mailSoon, winAlerts, openWins, [entriesToday], [ytd]] = await Promise.all([
    getTrackedRows(user.id, now),
    db
      .select({ id: amoeEntries.id, mailBy: amoeEntries.mailBy, title: sweepstakes.title, sweepstakesId: sweepstakes.id })
      .from(amoeEntries)
      .innerJoin(sweepstakes, eq(sweepstakes.id, amoeEntries.sweepstakesId))
      .where(and(eq(amoeEntries.userId, user.id), inArray(amoeEntries.status, ["planned", "prepared"]), lte(amoeEntries.mailBy, weekAhead)))
      .orderBy(amoeEntries.mailBy),
    db
      .select()
      .from(inboundMessages)
      .where(and(eq(inboundMessages.userId, user.id), eq(inboundMessages.category, "win_notice"), eq(inboundMessages.dismissed, false)))
      .orderBy(sql`${inboundMessages.receivedAt} desc`)
      .limit(5),
    db
      .select()
      .from(wins)
      .where(and(eq(wins.userId, user.id), inArray(wins.status, ["notified", "claimed"])))
      .orderBy(wins.claimDeadline),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(entries)
      .where(and(eq(entries.userId, user.id), gte(entries.enteredAt, new Date(now.getTime() - 86_400_000)))),
    db
      .select({ total: sql<number>`coalesce(sum(${wins.arvCents}), 0)::int` })
      .from(wins)
      .where(and(eq(wins.userId, user.id), eq(wins.status, "received"), gte(wins.receivedAt, startOfYear))),
  ]);

  const due = rows.filter((r) => r.due);
  const endingSoon = rows
    .filter((r) => r.endsAt && r.endsAt > now && r.endsAt.getTime() - now.getTime() < 7 * 86_400_000)
    .filter((r, i, all) => all.findIndex((x) => x.sweepstakesId === r.sweepstakesId) === i);

  return (
    <div>
      <h1>Today</h1>
      {winAlerts.length > 0 && (
        <div className="notice warn">
          <strong>Possible win notice{winAlerts.length > 1 ? "s" : ""}!</strong>{" "}
          {winAlerts.map((m) => (
            <span key={m.id}>
              “{m.subject}” {m.scamSignals.length > 0 && <span className="badge bad">scam signs</span>}{" "}
            </span>
          ))}
          <Link href="/inbox">Review in Inbox →</Link>
        </div>
      )}

      <div className="grid">
        <div className="card">
          <div className="muted small">Entries due now</div>
          <div className="stat">{due.length}</div>
        </div>
        <div className="card">
          <div className="muted small">Entered in last 24h</div>
          <div className="stat">{entriesToday?.n ?? 0}</div>
        </div>
        <div className="card">
          <div className="muted small">Mail-in to send this week</div>
          <div className="stat">{mailSoon.length}</div>
        </div>
        <div className="card">
          <div className="muted small">Wins received this year</div>
          <div className="stat">{money(ytd?.total ?? 0)}</div>
        </div>
      </div>

      <h2>Due now</h2>
      {due.length === 0 ? (
        <div className="card empty">
          You&apos;re all caught up. <Link href="/sweepstakes">Add more sweepstakes</Link>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Sweepstakes</th>
                <th>Entrant</th>
                <th>Ends</th>
                <th>Last entry</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {due.map((r) => (
                <tr key={`${r.trackedId}-${r.profileId}`}>
                  <td>
                    <Link href={`/sweepstakes/${r.sweepstakesId}`}>{r.title}</Link>
                    {r.totalArvCents ? <span className="muted small"> · {money(r.totalArvCents)}</span> : null}
                  </td>
                  <td>{r.profileName}</td>
                  <td>
                    {fmtDate(r.endsAt)} <span className="muted small">{relDays(r.endsAt)}</span>
                  </td>
                  <td className="muted small">{fmtDateTime(r.lastEntryAt)}</td>
                  <td className="row">
                    <a className="button small secondary" href={r.url} target="_blank" rel="noopener noreferrer">
                      Open
                    </a>
                    <form action={markEntered} className="inline">
                      <input type="hidden" name="sweepstakesId" value={r.sweepstakesId} />
                      <input type="hidden" name="profileId" value={r.profileId} />
                      <button className="small">Mark entered</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid" style={{ marginTop: 16 }}>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Ending within 7 days</h2>
          {endingSoon.length === 0 ? (
            <p className="muted">Nothing ending soon.</p>
          ) : (
            <ul>
              {endingSoon.map((r) => (
                <li key={r.sweepstakesId}>
                  <Link href={`/sweepstakes/${r.sweepstakesId}`}>{r.title}</Link> <span className="muted small">{relDays(r.endsAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Mail-in deadlines</h2>
          {mailSoon.length === 0 ? (
            <p className="muted">No mail-in entries due this week.</p>
          ) : (
            <ul>
              {mailSoon.map((a) => (
                <li key={a.id}>
                  <Link href={`/sweepstakes/${a.sweepstakesId}`}>{a.title}</Link> — mail by {fmtDate(a.mailBy)}{" "}
                  <span className="muted small">{relDays(a.mailBy)}</span>
                </li>
              ))}
            </ul>
          )}
          <Link href="/amoe" className="small">
            Open batch planner →
          </Link>
        </div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Open wins</h2>
          {openWins.length === 0 ? (
            <p className="muted">No wins waiting on paperwork.</p>
          ) : (
            <ul>
              {openWins.map((w) => (
                <li key={w.id}>
                  {w.prize}{" "}
                  {w.claimDeadline && (
                    <span className="badge warn">
                      claim by {fmtDate(w.claimDeadline)} ({relDays(w.claimDeadline)})
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <Link href="/wins" className="small">
            Manage wins →
          </Link>
        </div>
      </div>
    </div>
  );
}
