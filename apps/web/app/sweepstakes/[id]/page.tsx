import Link from "next/link";
import { notFound } from "next/navigation";
import { amoeEntries, and, db, desc, entrantProfiles, entries, eq, sweepstakes, trackedSweepstakes } from "@sweeptrack/db";
import { ActionForm } from "@/components/ActionForm";
import { isAdmin } from "@/lib/admin";
import { requireUser } from "@/lib/auth";
import { getTrackedRows } from "@/lib/sweeps";
import { FREQUENCY_LABEL, fmtDate, fmtDateTime, money, relDays } from "@/lib/format";
import { editSweepstakes, markEntered, planAmoeAction, setFrequencyOverride, trackFromCatalog } from "../../actions";

const isoDay = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : "");

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
  const canEdit = isAdmin(user) || s.submittedByUserId === user.id;
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
      {!tracked && (
        <form action={trackFromCatalog} style={{ marginBottom: 12 }}>
          <input type="hidden" name="sweepstakesId" value={s.id} />
          <button>Track this sweepstakes</button>
        </form>
      )}
      {s.description && <p className="muted">{s.description}</p>}
      {s.categories.length > 0 && (
        <p className="row">
          {s.categories.map((c) => (
            <span key={c} className="badge">
              {c}
            </span>
          ))}
        </p>
      )}
      {lowConfidence && !s.humanEditedAt && (
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

      {canEdit && (
        <details className="card" style={{ marginTop: 16 }}>
          <summary style={{ cursor: "pointer" }}>Correct details</summary>
          <div style={{ marginTop: 12 }}>
            <ActionForm action={editSweepstakes} submitLabel="Save corrections">
              <input type="hidden" name="id" value={s.id} />
              <div className="fields">
                <label style={{ gridColumn: "span 2" }}>
                  Title
                  <input name="title" defaultValue={s.title} required />
                </label>
                <label style={{ gridColumn: "span 2" }}>
                  Entry page URL
                  <input name="url" type="url" defaultValue={s.url} required />
                </label>
                <label style={{ gridColumn: "span 2" }}>
                  Official rules URL
                  <input name="rulesUrl" type="url" defaultValue={s.rulesUrl ?? ""} />
                </label>
                <label>
                  Sponsor
                  <input name="sponsor" defaultValue={s.sponsor ?? ""} />
                </label>
                <label>
                  Starts
                  <input name="startsAt" type="date" defaultValue={isoDay(s.startsAt)} />
                </label>
                <label>
                  Ends
                  <input name="endsAt" type="date" defaultValue={s.endsAt ? isoDay(new Date(s.endsAt.getTime() - 86_400_000)) : ""} />
                </label>
                <label>
                  Frequency
                  <select name="frequency" defaultValue={s.frequency}>
                    {Object.entries(FREQUENCY_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Total ARV ($)
                  <input name="arv" type="number" min="0" step="0.01" defaultValue={s.totalArvCents != null ? s.totalArvCents / 100 : ""} />
                </label>
                <label>
                  Minimum age
                  <input name="minAge" type="number" min="0" max="30" defaultValue={s.minAge ?? ""} />
                </label>
                <label>
                  Void in states
                  <input name="excludedStates" defaultValue={s.excludedStates.join(", ")} placeholder="FL, NY, RI" />
                </label>
                <label style={{ gridColumn: "span 2" }}>
                  Mail-in address (blank if none)
                  <input name="amoeAddress" defaultValue={a?.address ?? ""} />
                </label>
                <label>
                  Mail-in deadline
                  <input name="amoeDeadline" type="date" defaultValue={isoDay(a?.deadline)} />
                </label>
                <label>
                  Deadline type
                  <select name="amoeDeadlineType" defaultValue={a?.deadlineType ?? "unknown"}>
                    <option value="postmarked_by">Postmarked by</option>
                    <option value="received_by">Received by</option>
                    <option value="unknown">Unknown</option>
                  </select>
                </label>
                <label>
                  Third-party mailing allowed
                  <select name="thirdPartyAllowed" defaultValue={a?.thirdPartyAllowed ?? "unknown"}>
                    <option value="unknown">Unknown</option>
                    <option value="no">No</option>
                    <option value="yes">Yes</option>
                  </select>
                </label>
              </div>
            </ActionForm>
          </div>
        </details>
      )}

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
