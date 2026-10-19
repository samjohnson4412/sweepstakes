import { classifyEmail, type EmailClassification } from "@sweeptrack/core";
import { db, eq, inboundMessages, users, wins } from "@sweeptrack/db";
import { queueNewsletterLinks } from "./newsletter";

export interface IncomingEmail {
  to: string;
  from: string;
  subject: string;
  text: string;
  html?: string | null;
}

export function inboundDomain(): string {
  return process.env.INBOUND_EMAIL_DOMAIN ?? "in.sweeptrack.local";
}

export function inboundAddress(token: string): string {
  return `u-${token}@${inboundDomain()}`;
}

/** The shared catalog inbox: subscribe this address to sweepstakes newsletters. */
export function catalogInboxAddress(): string {
  return `${process.env.CATALOG_INBOX_LOCALPART ?? "catalog"}@${inboundDomain()}`;
}

/** Extract the user token from any recipient matching u-<token>@... (To may list several). */
export function tokenFromRecipients(to: string): string | null {
  return to.match(/\bu-([a-z0-9_-]+)@/i)?.[1]?.toLowerCase() ?? null;
}

/**
 * Classify and store one email for a user. Synced mailboxes pass `onlyRelevant` so we
 * keep sweepstakes mail only, and `externalId` so re-syncs don't duplicate.
 */
export async function storeUserEmail(
  userId: string,
  msg: Omit<IncomingEmail, "to">,
  opts: { source?: "forward" | "google" | "microsoft"; externalId?: string; onlyRelevant?: boolean } = {},
): Promise<{ stored: boolean; classification: EmailClassification }> {
  const result = classifyEmail(msg);
  if (opts.onlyRelevant && (result.category === "other" || result.category === "promo")) return { stored: false, classification: result };

  const [saved] = await db
    .insert(inboundMessages)
    .values({
      userId,
      fromAddress: msg.from.slice(0, 500),
      subject: msg.subject.slice(0, 1000),
      textBody: msg.text.slice(0, 100_000),
      category: result.category,
      confidence: result.confidence,
      signals: result.signals,
      scamSignals: result.scamSignals,
      links: result.links.slice(0, 200),
      source: opts.source ?? "forward",
      externalId: opts.externalId ?? null,
    })
    .onConflictDoNothing()
    .returning();
  if (!saved) return { stored: false, classification: result };

  // Draft a win record for likely-real notices so claim deadlines get tracked immediately.
  if (result.category === "win_notice" && result.scamSignals.length === 0) {
    await db.insert(wins).values({
      userId,
      inboundMessageId: saved.id,
      prize: msg.subject.slice(0, 200),
      sponsor: msg.from.replace(/<.*>/, "").trim().slice(0, 200) || null,
      notifiedAt: new Date().toISOString().slice(0, 10),
      notes: result.claimDeadlineText ? `Claim by: ${result.claimDeadlineText}` : null,
    });
  }
  // Users' newsletters also feed the shared catalog.
  if (result.category === "newsletter") await queueNewsletterLinks({ html: msg.html, text: msg.text }, "user-newsletter");
  return { stored: true, classification: result };
}

/** Entry point for the inbound-email webhook. */
export async function routeInboundEmail(msg: IncomingEmail) {
  if (msg.to.toLowerCase().includes(catalogInboxAddress().toLowerCase())) {
    const queued = await queueNewsletterLinks({ html: msg.html, text: msg.text }, "newsletter-inbox");
    return { ok: true as const, kind: "catalog" as const, queued };
  }
  const token = tokenFromRecipients(msg.to);
  if (!token) return { ok: false as const, reason: "no-recipient-token" };
  const user = await db.query.users.findFirst({ where: eq(users.inboundToken, token) });
  if (!user) return { ok: false as const, reason: "unknown-recipient" };
  const { classification } = await storeUserEmail(user.id, msg);
  return { ok: true as const, kind: "user" as const, category: classification.category };
}
