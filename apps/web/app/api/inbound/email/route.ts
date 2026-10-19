import { timingSafeEqual } from "node:crypto";
import { processInboundEmail } from "@/lib/inbound";

/**
 * Inbound email webhook. Point your provider (Postmark, SendGrid Inbound Parse, Mailgun, SES→Lambda)
 * here and have it send `X-Inbound-Secret: $INBOUND_WEBHOOK_SECRET`.
 * Accepts JSON `{ to, from, subject, text }` or multipart/form-data with the same field names
 * (SendGrid's format). Postmark's `To/From/Subject/TextBody` keys are also understood.
 */
export async function POST(req: Request) {
  const secret = process.env.INBOUND_WEBHOOK_SECRET;
  const given = req.headers.get("x-inbound-secret") ?? "";
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let fields: Record<string, unknown>;
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    fields = (await req.json()) as Record<string, unknown>;
  } else {
    fields = Object.fromEntries((await req.formData()).entries());
  }
  const pick = (...keys: string[]) => {
    for (const k of keys) if (typeof fields[k] === "string") return fields[k] as string;
    return "";
  };
  const result = await processInboundEmail({
    to: pick("to", "To", "OriginalRecipient"),
    from: pick("from", "From"),
    subject: pick("subject", "Subject"),
    text: pick("text", "TextBody", "body-plain") || pick("html", "HtmlBody").replace(/<[^>]+>/g, " "),
  });
  // Always 200 for unknown recipients so providers don't retry forever.
  return Response.json(result.ok ? { ok: true, category: result.classification.category } : { ok: false, reason: result.reason });
}
