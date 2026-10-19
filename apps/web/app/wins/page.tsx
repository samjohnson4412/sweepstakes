import { expects1099 } from "@sweeptrack/core";
import { db, desc, eq, wins } from "@sweeptrack/db";
import { ActionForm } from "@/components/ActionForm";
import { requireUser } from "@/lib/auth";
import { fmtDate, money, relDays } from "@/lib/format";
import { saveWin } from "../actions";

export const dynamic = "force-dynamic";

const STATUSES = ["notified", "claimed", "received", "forfeited", "declined"] as const;

function WinFields({ w }: { w?: typeof wins.$inferSelect }) {
  return (
    <>
      {w && <input type="hidden" name="id" value={w.id} />}
      <div className="fields">
        <label>
          Prize
          <input name="prize" defaultValue={w?.prize} required />
        </label>
        <label>
          Sponsor
          <input name="sponsor" defaultValue={w?.sponsor ?? ""} />
        </label>
        <label>
          ARV ($)
          <input name="arv" type="number" min="0" step="0.01" defaultValue={w ? (w.arvCents / 100).toFixed(2) : ""} />
        </label>
        <label>
          Status
          <select name="status" defaultValue={w?.status ?? "notified"}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          Notified
          <input name="notifiedAt" type="date" defaultValue={w?.notifiedAt ?? ""} />
        </label>
        <label>
          Claim / affidavit deadline
          <input name="claimDeadline" type="date" defaultValue={w?.claimDeadline ?? ""} />
        </label>
        <label>
          Received
          <input name="receivedAt" type="date" defaultValue={w?.receivedAt ?? ""} />
        </label>
      </div>
      <div className="row">
        <label className="check">
          <input type="checkbox" name="affidavitSubmitted" defaultChecked={w?.affidavitSubmitted} /> Affidavit submitted
        </label>
        <label className="check">
          <input type="checkbox" name="w9Submitted" defaultChecked={w?.w9Submitted} /> W-9 submitted
        </label>
      </div>
      <label>
        Notes
        <textarea name="notes" rows={2} defaultValue={w?.notes ?? ""} />
      </label>
    </>
  );
}

export default async function WinsPage() {
  const user = await requireUser();
  const rows = await db.select().from(wins).where(eq(wins.userId, user.id)).orderBy(desc(wins.createdAt));
  const year = new Date().getUTCFullYear();
  const years = [...new Set([year, ...rows.map((w) => (w.receivedAt ? Number(w.receivedAt.slice(0, 4)) : year))])].sort((a, b) => b - a);
  const receivedThisYear = rows.filter((w) => w.status === "received" && w.receivedAt?.startsWith(String(year)));
  const total = receivedThisYear.reduce((sum, w) => sum + w.arvCents, 0);

  return (
    <div>
      <h1>Wins</h1>
      <div className="grid">
        <div className="card">
          <div className="muted small">Received in {year}</div>
          <div className="stat">{money(total)}</div>
          <div className="small muted">{receivedThisYear.length} prizes · {receivedThisYear.filter((w) => expects1099(w.arvCents)).length} likely 1099s</div>
        </div>
        <div className="card stack">
          <div className="muted small">Tax export (CSV)</div>
          <div className="row">
            {years.map((y) => (
              <a key={y} className="button small secondary" href={`/wins/export?year=${y}`}>
                {y}
              </a>
            ))}
          </div>
          <div className="small muted">Prizes are taxable income at ARV. Sponsors generally issue a 1099-MISC at $600+. Not tax advice.</div>
        </div>
      </div>

      <h2>Log a win</h2>
      <div className="card">
        <ActionForm action={saveWin} submitLabel="Add win">
          <WinFields />
        </ActionForm>
      </div>

      <h2>All wins ({rows.length})</h2>
      {rows.length === 0 && <div className="card empty">No wins yet. They&apos;ll show up here — good luck!</div>}
      <div className="stack">
        {rows.map((w) => (
          <details key={w.id} className="card">
            <summary className="row" style={{ cursor: "pointer" }}>
              <strong>{w.prize}</strong>
              <span className="muted">{money(w.arvCents)}</span>
              <span className={`badge ${w.status === "received" ? "good" : w.status === "notified" ? "warn" : ""}`}>{w.status}</span>
              {w.claimDeadline && ["notified", "claimed"].includes(w.status) && (
                <span className="badge warn">
                  claim by {fmtDate(w.claimDeadline)} ({relDays(w.claimDeadline)})
                </span>
              )}
              {expects1099(w.arvCents) && <span className="badge">1099</span>}
            </summary>
            <div style={{ marginTop: 12 }}>
              <ActionForm action={saveWin} submitLabel="Save">
                <WinFields w={w} />
              </ActionForm>
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
