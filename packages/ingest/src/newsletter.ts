import { canonicalUrl, extractAnchors, extractLinks, isLikelySweepsLink, type Anchor } from "@sweeptrack/core";
import { analyzePage, openToUs, upsertCatalog } from "./catalog";
import { resolveRedirects } from "./fetch";
import { enqueue } from "./jobs";

const MAX_LINKS_PER_EMAIL = 30;

/** Queue the sweepstakes-looking links from a newsletter for import into the catalog. */
export async function queueNewsletterLinks(body: { html?: string | null; text: string }, sourceId: string): Promise<number> {
  const anchors: Anchor[] = body.html
    ? extractAnchors(body.html, "https://newsletter.invalid/")
    : extractLinks(body.text).map((url) => ({ url, text: "" }));
  const unique = new Map<string, Anchor>();
  for (const a of anchors) {
    if (!isLikelySweepsLink(a)) continue;
    try {
      unique.set(canonicalUrl(a.url), a);
    } catch {
      // ignore malformed
    }
  }
  const picked = [...unique.values()].slice(0, MAX_LINKS_PER_EMAIL);
  for (const a of picked) await enqueue("import-link", { url: a.url, text: a.text, sourceId });
  return picked.length;
}

/** Job: follow tracking redirects, read the page, and add it if it looks like a US sweepstakes. */
export async function importLinkJob(payload: Record<string, unknown>): Promise<void> {
  const url = String(payload.url);
  const sourceId = String(payload.sourceId ?? "newsletter");
  const finalUrl = await resolveRedirects(url);
  const a = await analyzePage(finalUrl, { polite: true });
  const looksLikeSweeps =
    Boolean(a.parsed.endsAt || a.parsed.amoe.available || a.parsed.frequency) ||
    /sweep|giveaway|contest|instant win/i.test(`${a.title} ${String(payload.text ?? "")}`);
  if (!looksLikeSweeps || !openToUs(a.parsed)) return;
  await upsertCatalog(
    { url: a.finalUrl, title: a.title ?? new URL(a.finalUrl).hostname, rulesUrl: a.rulesUrl, parsed: a.parsed, usedLlm: a.usedLlm },
    { sourceId, externalUrl: url },
  );
}
