import { and, db, desc, eq, inboundMessages } from "@sweeptrack/db";
import { requireUser } from "@/lib/auth";
import { inboundAddress } from "@/lib/inbound";
import { fmtDateTime } from "@/lib/format";
import { dismissMessage, importLink } from "../actions";

export const dynamic = "force-dynamic";

const CATEGORY_BADGE: Record<string, string> = { win_notice: "warn", confirmation: "good" };

export default async function InboxPage() {
  const user = await requireUser();
  const messages = await db
    .select()
    .from(inboundMessages)
    .where(and(eq(inboundMessages.userId, user.id), eq(inboundMessages.dismissed, false)))
    .orderBy(desc(inboundMessages.receivedAt))
    .limit(100);

  return (
    <div>
      <h1>Inbox</h1>
      <div className="card small">
        Forward sweepstakes emails to <code>{inboundAddress(user.inboundToken)}</code>. Set up a Gmail filter (e.g.
        subject contains “winner”, “sweepstakes”, “giveaway”, or from your favorite sweeps newsletters) to forward
        automatically. We flag win notices, entry confirmations, and pull sweepstakes links out of newsletters.
      </div>

      <h2>Messages</h2>
      {messages.length === 0 && <div className="card empty">No forwarded emails yet.</div>}
      <div className="stack">
        {messages.map((m) => (
          <div key={m.id} className="card stack">
            <div className="row">
              <span className={`badge ${CATEGORY_BADGE[m.category] ?? ""}`}>{m.category.replace("_", " ")}</span>
              <strong>{m.subject}</strong>
              <span className="muted small">
                {m.fromAddress} · {fmtDateTime(m.receivedAt)}
              </span>
            </div>
            {m.scamSignals.length > 0 && (
              <div className="notice error small">
                Possible scam: {m.scamSignals.join(", ")}. Legitimate sweepstakes never ask winners to pay to claim a prize.
              </div>
            )}
            {m.category === "win_notice" && m.scamSignals.length === 0 && (
              <div className="small">
                A draft win was added to <a href="/wins">Wins</a>. Verify the sender against the official rules before
                sending personal information.
              </div>
            )}
            {m.signals.length > 0 && <div className="small muted">Signals: {m.signals.join(", ")}</div>}
            {m.links.length > 0 && m.category !== "win_notice" && (
              <details>
                <summary className="small">{m.links.length} links</summary>
                <ul className="small">
                  {m.links.slice(0, 30).map((l) => (
                    <li key={l} className="row">
                      <span className="mono" style={{ wordBreak: "break-all" }}>
                        {l}
                      </span>
                      <form action={importLink} className="inline">
                        <input type="hidden" name="url" value={l} />
                        <button className="small secondary">Track</button>
                      </form>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <form action={dismissMessage}>
              <input type="hidden" name="id" value={m.id} />
              <button className="small secondary">Dismiss</button>
            </form>
          </div>
        ))}
      </div>
    </div>
  );
}
