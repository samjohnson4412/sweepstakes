import { classifyEmail } from "@sweeptrack/core";
import { db, eq, inboundMessages, users, wins } from "@sweeptrack/db";

export interface InboundEmail {
  to: string;
  from: string;
  subject: string;
  text: string;
}

export function inboundAddress(token: string): string {
  return `u-${token}@${process.env.INBOUND_EMAIL_DOMAIN ?? "in.sweeptrack.local"}`;
}

/** Extract the user token from any recipient matching u-<token>@... (To may list several). */
export function tokenFromRecipients(to: string): string | null {
  return to.match(/\bu-([a-z0-9_-]+)@/i)?.[1]?.toLowerCase() ?? null;
}

export async function processInboundEmail(msg: InboundEmail) {
  const token = tokenFromRecipients(msg.to);
  if (!token) return { ok: false as const, reason: "no-recipient-token" };
  const user = await db.query.users.findFirst({ where: eq(users.inboundToken, token) });
  if (!user) return { ok: false as const, reason: "unknown-recipient" };

  const result = classifyEmail(msg);
  const [saved] = await db
    .insert(inboundMessages)
    .values({
      userId: user.id,
      fromAddress: msg.from.slice(0, 500),
      subject: msg.subject.slice(0, 1000),
      textBody: msg.text.slice(0, 100_000),
      category: result.category,
      confidence: result.confidence,
      signals: result.signals,
      scamSignals: result.scamSignals,
      links: result.links.slice(0, 200),
    })
    .returning();

  // Draft a win record for likely-real notices so claim deadlines get tracked immediately.
  if (result.category === "win_notice" && result.scamSignals.length === 0) {
    await db.insert(wins).values({
      userId: user.id,
      inboundMessageId: saved!.id,
      prize: msg.subject.slice(0, 200),
      sponsor: msg.from.replace(/<.*>/, "").trim().slice(0, 200) || null,
      notifiedAt: new Date().toISOString().slice(0, 10),
      notes: result.claimDeadlineText ? `Claim by: ${result.claimDeadlineText}` : null,
    });
  }
  return { ok: true as const, messageId: saved!.id, classification: result };
}
