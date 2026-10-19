import Link from "next/link";
import { notFound } from "next/navigation";
import { amoeEntries, and, db, desc, entrantProfiles, entries, eq, sweepstakes, trackedSweepstakes } from "@sweeptrack/db";
import { requireUser } from "@/lib/auth";
import { getTrackedRows } from "@/lib/sweeps";
import { FREQUENCY_LABEL, fmtDate, fmtDateTime, money, relDays } from "@/lib/format";
import { markEntered, planAmoeAction, setFrequencyOverride } from "../../actions";

export const dynamic = "force-dynamic";

export default async function SweepstakesDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const user = await requireUser();
  const s = await db.query.sweepstakes.findFirst({ where: eq(sweepstakes.id, id) });
  if (!s) notFound();

  const [tracked, rows, history, amoe, profiles] = await Promise.all([
    db.query.trackedSweepstakes.findFirst({ where: and(eq(trackedSweepstakes.userId, user.id), eq(trackedSweepstakes.sweepstakesId, id)) }),
    getTrackedRows(user.id).then((r) => r.filter((x) => x.sweepstakesId === id)),
    db
      .select({ e: entries, firstName: entrantProfiles.firstName })
      .from(entries)
      .innerJoin(entrantProfiles, eq(entrantProfiles.id, entries.profileId))
      .where(and(eq(entries.userId, user.id), eq(entries.sweepstakesId, id)))
      .orderBy(desc(entries.enteredAt))
      .limit(30),
    db.select().from(amoeEntries).where(and(eq(amoeEntries.userId, user.id), eq(amoeEntries.sweepstakesId, id))),
    db.select().from(entrantProfiles).where(eq(entrantProfiles.userId, user.id)),
  ]);

  const a = s.amoe;
  const lowConfidence = Object.values(s.parseConfidence ?? {}).some((c) => c < 0.6);

  return (
    <div>
      <p className="small">
        <Link href="/sweepstakes">← Sweepstakes</Link>
      </p>
      <h1>{s.title}</h1>
      <div className="row" style={{ marginBottom: 12 }}>
        <a className="button" href={s.url} target="_blank" rel="noopener noreferrer">
          Open entry page
        </a>
        {s.rulesUrl && (
          <a className="button secondary" href={s.rulesUrl} target="_blank" rel="noopener noreferrer">
            Official rules
          </a>
        )}
      </div>
      {lowConfidence && (
        <div className="notice warn small">Some details were auto-detected with low confidence. Double-check them against the official rules.</div>
      )}

      <div className="grid">
        <div className="card stack">
          <div>
            <span className="muted small">Sponsor</span>
            <div>{s.sponsor ?? "—"}</div>
          </div>
          <div>
            <span className="muted small">Dates</span>
            <div>
              {fmtDate(s.startsAt)} → {fmtDate(s.endsAt)} <span className="muted small">{relDays(s.endsAt)}</span>
            </div>
          </div>
          <div>
            <span className="muted small">Total ARV</span>
            <div>{money(s.totalArvCents)}</div>
          </div>
          <div>
            <span className="muted small">Eligibility</span>
            <div>
              {s.minAge ? `${s.minAge}+` : "Age —"} · {s.countries.length ? s.countries.join(", ") : "Countries —"}
              {s.excludedStates.length > 0 && <> · void in {s.excludedStates.join(", ")}</>}
            </div>
          </div>
        </div>

        <div className="card stack">
          <span className="muted small">Entry frequency</span>
          <div>
            Detected: <strong>{FREQUENCY_LABEL[s.frequency]}</strong>
          </div>
          {tracked && (
            <form action={setFrequencyOverride} className="row">
              <input type="hidden" name="trackedId" value={tracked.id} />
              <select name="frequency" defaultValue={tracked.frequencyOverride ?? ""}>
                <option value="">Use detected</option>
                {Object.entries(FREQUENCY_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <button className="small secondary">Override</button>
            </form>
          )}
          {rows.map((r) => (
            <div key={r.profileId} className="row">
              <span>{r.profileName}:</span>
              {r.due ? (
                <form action={markEntered} className="inline">
                  <input type="hidden" name="sweepstakesId" value={s.id} />
                  <input type="hidden" name="profileId" value={r.profileId} />
                  <button className="small">Mark entered</button>
                </form>
              ) : (
                <span className="muted small">
                  {r.nextEligibleAt ? `next entry ${fmtDateTime(r.nextEligibleAt)}` : "no more entries allowed"}
                </span>
              )}
            </div>
          ))}
        </div>

        <div className="card stack">
          <span className="muted small">Mail-in (AMOE)</span>
          {a?.available ? (
            <>
              <div className="mono small" style={{ whiteSpace: "pre-wrap" }}>
                {a.address ?? "Address not detected. See the official rules."}
              </div>
              <div className="small">
                {a.deadlineType !== "unknown" && (
                  <>
                    {a.deadlineType === "postmarked_by" ? "Postmarked by" : "Received by"} {fmtDate(a.deadline)}
                    <br />
                  </>
                )}
                {a.handwrittenRequired && <span className="badge">hand-print</span>} {a.cardSize && <span className="badge">{a.cardSize}&quot; card</span>}{" "}
                {a.sasRequired && <span className="badge">SASE</span>} {a.limitPerEnvelope && <span className="badge">1 per envelope</span>}{" "}
                {a.thirdPartyAllowed === "no" && <span className="badge bad">no third-party entries</span>}
              </div>
              {profiles.length > 0 && (
                <form action={planAmoeAction} className="row">
                  <input type="hidden" name="sweepstakesId" value={s.id} />
                  <select name="profileId">
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.firstName} {p.lastName}
                      </option>
                    ))}
                  </select>
                  <button className="small">Plan mail-in entry</button>
                </form>
              )}
              {amoe.length > 0 && (
                <div className="small muted">
                  {amoe.length} mail-in entr{amoe.length === 1 ? "y" : "ies"} planned/sent. <Link href="/amoe">Batch planner →</Link>
                </div>
              )}
            </>
          ) : (
            <div className="muted small">No mail-in method detected.</div>
          )}
        </div>
      </div>

      <h2>Entry history</h2>
      {history.length === 0 ? (
        <div className="card empty">No entries logged yet.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Entrant</th>
              <th>Method</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {history.map(({ e, firstName }) => (
              <tr key={e.id}>
                <td>{fmtDateTime(e.enteredAt)}</td>
                <td>{firstName}</td>
                <td>{e.method}</td>
                <td className="muted">{e.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
