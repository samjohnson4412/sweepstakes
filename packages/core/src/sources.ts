import { BOT_USER_AGENT } from "./robots";

/**
 * Catalog ingestion: adapters turn an external source into raw listings, which the
 * pipeline normalizes, dedups (by canonical URL), and enriches via the rules parser.
 *
 * Listing-site use is governed by the operator's agreements with each site; the
 * pipeline honors robots.txt per source by default.
 */
export interface RawListing {
  title: string;
  url: string;
  sourceId: string;
  publishedAt?: Date | null;
  endsAt?: Date | null;
  summary?: string | null;
  /** Full HTML body when the feed carries it (e.g. RSS content:encoded). */
  contentHtml?: string | null;
  categories?: string[];
}

export interface SourceAdapter {
  id: string;
  name: string;
  fetchListings(fetcher?: typeof fetch): Promise<RawListing[]>;
}

const TRACKING_PARAMS = /^(utm_\w+|fbclid|gclid|mc_cid|mc_eid|ref|referrer|source|_hs\w+)$/i;

/** Normalize a URL for dedup: lowercase host, drop www, fragments, tracking params, trailing slash. */
export function canonicalUrl(raw: string): string {
  const u = new URL(raw.trim());
  u.hash = "";
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
  for (const key of [...u.searchParams.keys()]) if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
  u.searchParams.sort();
  let s = u.toString();
  if (u.pathname !== "/" && s.endsWith("/")) s = s.slice(0, -1);
  return s.replace(/\/\?/, "?");
}

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

/** Numeric HTML entities that survive CDATA (e.g. &#8211;). */
function decodeEntities(s: string): string {
  return s.replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)));
}

function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decodeXml(m[1]!) : null;
}

/** Parse RSS 2.0 or Atom without dependencies. */
export function parseFeed(xml: string, sourceId: string): RawListing[] {
  const out: RawListing[] = [];
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  for (const block of items) {
    const title = tag(block, "title");
    const link = tag(block, "link") ?? block.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] ?? null;
    if (!title || !link) continue;
    const date = tag(block, "pubDate") ?? tag(block, "published") ?? tag(block, "updated");
    const parsed = date ? new Date(date) : null;
    const categories = [...block.matchAll(/<category(?:\s[^>]*)?>([\s\S]*?)<\/category>/gi)]
      .map((m) => decodeXml(m[1]!))
      .filter(Boolean);
    out.push({
      title: decodeEntities(title),
      url: link,
      sourceId,
      publishedAt: parsed && !Number.isNaN(parsed.getTime()) ? parsed : null,
      summary: tag(block, "description") ?? tag(block, "summary"),
      contentHtml: tag(block, "content:encoded") ?? tag(block, "content"),
      categories,
    });
  }
  return out;
}

export function rssAdapter(opts: { id: string; name: string; feedUrl: string }): SourceAdapter {
  return {
    id: opts.id,
    name: opts.name,
    async fetchListings(fetcher = fetch) {
      const res = await fetcher(opts.feedUrl, { headers: { "user-agent": `${BOT_USER_AGENT}/0.1` } });
      if (!res.ok) throw new Error(`${opts.id}: HTTP ${res.status}`);
      return parseFeed(await res.text(), opts.id);
    },
  };
}
