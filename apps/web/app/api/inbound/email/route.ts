import { routeInboundEmail } from "@sweeptrack/ingest";
import { secretMatches } from "@/lib/secrets";

/**
 * Inbound email webhook. The Cloudflare Email Worker in infra/email-worker (or Postmark,
 * SendGrid Inbound Parse, Mailgun) POSTs here with `X-Inbound-Secret: $INBOUND_WEBHOOK_SECRET`.
 * Mail to u-<token>@ goes to that user; mail to catalog@ feeds the shared catalog.
 * Accepts JSON `{ to, from, subject, text }` or multipart/form-data with the same field names
 * (SendGrid's format). Postmark's `To/From/Subject/TextBody` keys are also understood.
 */
export async function POST(req: Request) {
  if (!secretMatches(req.headers.get("x-inbound-secret"), process.env.INBOUND_WEBHOOK_SECRET)) {
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
  const html = pick("html", "HtmlBody", "body-html") || null;
  const result = await routeInboundEmail({
    to: pick("to", "To", "OriginalRecipient"),
    from: pick("from", "From"),
    subject: pick("subject", "Subject"),
    text: pick("text", "TextBody", "body-plain") || (html ?? "").replace(/<[^>]+>/g, " "),
    html,
  });
  // Always 200 for unknown recipients so providers don't retry forever.
  return Response.json(result);
}
