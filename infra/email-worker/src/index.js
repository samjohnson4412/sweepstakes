import PostalMime from "postal-mime";

/**
 * Cloudflare Email Routing → this Worker → POST /api/inbound/email.
 * Route a catch-all for in.<domain> to this Worker in the Cloudflare dashboard.
 */
export default {
  async email(message, env) {
    const parsed = await PostalMime.parse(message.raw);
    const res = await fetch(`${env.APP_URL}/api/inbound/email`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-inbound-secret": env.INBOUND_WEBHOOK_SECRET },
      body: JSON.stringify({
        to: message.to,
        from: message.from,
        subject: parsed.subject ?? "",
        text: parsed.text ?? "",
        html: parsed.html ?? null,
      }),
    });
    // A 5xx makes Cloudflare bounce the message, so the sender knows it wasn't processed.
    if (res.status >= 500) message.setReject(`Processing failed (${res.status})`);
  },
};
