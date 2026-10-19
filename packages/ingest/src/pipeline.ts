import {
  canonicalUrl,
  extractAnchors,
  extractTitle,
  frequencyFromCategories,
  htmlToText,
  mainContent,
  pageMatchesListing,
  parseFeed,
  parseRules,
  parseSitemap,
  pickSponsorLink,
  type ParsedRules,
  type RawListing,
} from "@sweeptrack/core";
import { and, db, eq, ingestSeen, inArray, isNull, lt, or, sources, sql } from "@sweeptrack/db";
import { analyzePage, openToUs, parseWithFallback, upsertCatalog } from "./catalog";
import { fetchPublicPage, RobotsDisallowedError } from "./fetch";
import type { SourceRow } from "./sources-config";

const XML_ACCEPT = "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5";

/** "Win a Grill Sweepstakes - SiteName" → "Win a Grill Sweepstakes" */
export function cleanTitle(title: string): string {
  return title.replace(/\s+[|–—-]\s+[^|–—-]{2,40}$/, "").trim();
}

function titleFromSlug(url: string): string {
  const slug = new URL(url).pathname.split("/").filter(Boolean).pop() ?? url;
  return slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function fetchSourceListings(source: SourceRow): Promise<RawListing[]> {
  if (!source.url) return [];
  const { html: body } = await fetchPublicPage(source.url, { polite: true, robots: source.respectRobots, accept: XML_ACCEPT, maxBytes: 5_000_000 });
  if (source.kind === "rss") return parseFeed(body, source.id);
  if (source.kind === "sitemap") {
    let entries = parseSitemap(body);
    if (entries[0]?.isIndex) {
      const child = entries.sort((a, b) => (b.lastmod?.getTime() ?? 0) - (a.lastmod?.getTime() ?? 0))[0]!;
      entries = parseSitemap((await fetchPublicPage(child.url, { polite: true, robots: source.respectRobots, accept: XML_ACCEPT, maxBytes: 5_000_000 })).html);
    }
    return entries
      .sort((a, b) => (b.lastmod?.getTime() ?? 0) - (a.lastmod?.getTime() ?? 0))
      .map((e) => ({ title: titleFromSlug(e.url), url: e.url, sourceId: source.id, publishedAt: e.lastmod }));
  }
  return [];
}

export type ListingOutcome = { status: "added" | "merged"; sweepstakesId: string } | { status: "skipped"; reason: string };

/** Turn one listing into a catalog record: find the sponsor link, read the rules, merge. */
export async function processListing(listing: RawListing, source: SourceRow, now = new Date()): Promise<ListingOutcome> {
  let html = listing.contentHtml ?? listing.summary ?? "";
  let title = cleanTitle(listing.title);
  let sponsorUrl = pickSponsorLink(extractAnchors(html, listing.url), listing.url);

  if (source.fetchDetail && (!sponsorUrl || source.kind === "sitemap")) {
    const detail = await fetchPublicPage(listing.url, { polite: true, robots: source.respectRobots });
    if (source.kind === "sitemap") title = cleanTitle(extractTitle(detail.html) ?? title);
    const main = mainContent(detail.html);
    html += "\n" + main;
    sponsorUrl ??= pickSponsorLink(extractAnchors(main, detail.finalUrl), listing.url);
  }

  const listingText = htmlToText(html);
  let parsed: ParsedRules = parseRules(listingText);
  let rulesUrl: string | null = null;
  let usedLlm = false;

  if (sponsorUrl && source.followSponsor) {
    try {
      // Sponsor pages are fetched like a browser visit (no robots check), but paced.
      const a = await analyzePage(sponsorUrl, { polite: true, extraText: listingText });
      if (pageMatchesListing(title, { url: a.finalUrl, title: a.title, text: a.text.slice(listingText.length) })) {
        parsed = a.parsed;
        rulesUrl = a.rulesUrl;
        usedLlm = a.usedLlm;
        sponsorUrl = a.finalUrl;
      } else {
        sponsorUrl = null; // a link to some other promotion; keep the listing page
      }
    } catch {
      // Keep the listing-derived facts if the sponsor page is down or blocks us.
    }
  } else {
    ({ parsed, usedLlm } = await parseWithFallback(listingText));
  }

  if (!openToUs(parsed)) return { status: "skipped", reason: "not open to US residents" };
  if (parsed.endsAt && parsed.endsAt.getTime() < now.getTime() - 86_400_000) return { status: "skipped", reason: "already ended" };

  const { id, created } = await upsertCatalog(
    {
      url: sponsorUrl ?? listing.url,
      title,
      rulesUrl,
      description: htmlToText(listing.summary ?? listing.contentHtml ?? "").slice(0, 1500) || null,
      categories: listing.categories,
      parsed,
      frequencyHint: frequencyFromCategories(listing.categories ?? []),
      usedLlm,
    },
    { sourceId: source.id, externalUrl: listing.url },
  );
  return { status: created ? "added" : "merged", sweepstakesId: id };
}

export interface RunSummary {
  sourceId: string;
  fetched: number;
  processed: number;
  added: number;
  merged: number;
  skipped: number;
  errors: number;
}

/** Process a source's new listings (ones it hasn't seen before), up to its per-run cap. */
export async function runSource(sourceId: string, opts: { deadline?: number } = {}): Promise<RunSummary> {
  const source = await db.query.sources.findFirst({ where: eq(sources.id, sourceId) });
  if (!source) throw new Error(`Unknown source ${sourceId}`);
  const summary: RunSummary = { sourceId, fetched: 0, processed: 0, added: 0, merged: 0, skipped: 0, errors: 0 };
  let lastError: string | null = null;
  try {
    const listings = await fetchSourceListings(source);
    summary.fetched = listings.length;
    const keys = listings.map((l) => canonicalUrl(l.url));
    const seen = keys.length
      ? new Set(
          (await db.select({ k: ingestSeen.itemKey }).from(ingestSeen).where(and(eq(ingestSeen.sourceId, sourceId), inArray(ingestSeen.itemKey, keys)))).map(
            (r) => r.k,
          ),
        )
      : new Set<string>();
    const fresh = listings.filter((_, i) => !seen.has(keys[i]!)).slice(0, source.maxItemsPerRun);

    for (const listing of fresh) {
      if (opts.deadline && Date.now() > opts.deadline) break;
      const key = canonicalUrl(listing.url);
      try {
        const outcome = await processListing(listing, source);
        summary.processed++;
        summary[outcome.status]++;
        await db
          .insert(ingestSeen)
          .values({ sourceId, itemKey: key, sweepstakesId: outcome.status === "skipped" ? null : outcome.sweepstakesId })
          .onConflictDoNothing();
      } catch (e) {
        if (e instanceof RobotsDisallowedError) {
          summary.skipped++;
          await db.insert(ingestSeen).values({ sourceId, itemKey: key }).onConflictDoNothing();
        } else {
          // Not marked seen, so it's retried next run.
          summary.errors++;
          lastError = (e as Error).message;
        }
      }
    }
  } catch (e) {
    lastError = (e as Error).message;
    summary.errors++;
  }
  await db
    .update(sources)
    .set({
      lastRunAt: new Date(),
      lastStatus: summary.errors && !summary.processed ? "error" : "ok",
      lastError: lastError?.slice(0, 1000) ?? null,
      lastItemCount: summary.added + summary.merged,
    })
    .where(eq(sources.id, sourceId));
  return summary;
}

/** Run every enabled feed/sitemap source whose interval has elapsed. */
export async function runDueSources(deadline: number): Promise<RunSummary[]> {
  const due = await db
    .select()
    .from(sources)
    .where(
      and(
        eq(sources.enabled, true),
        inArray(sources.kind, ["rss", "sitemap"]),
        or(isNull(sources.lastRunAt), lt(sources.lastRunAt, sql`now() - (${sources.intervalMinutes} * interval '1 minute')`)),
      ),
    );
  const out: RunSummary[] = [];
  for (const s of due) {
    if (Date.now() > deadline) break;
    out.push(await runSource(s.id, { deadline }));
  }
  return out;
}
