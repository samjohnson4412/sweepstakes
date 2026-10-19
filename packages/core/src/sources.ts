/**
 * Catalog ingestion: adapters turn an external source into raw listings, which the
 * pipeline normalizes, dedups (by canonical URL), and enriches via the rules parser.
 *
 * Before enabling an adapter for a third-party listing site, review its Terms of
 * Service and robots.txt. Store facts + the sponsor link only, never editorial content.
 */
export interface RawListing {
  title: string;
  url: string;
  sourceId: string;
  publishedAt?: Date | null;
  endsAt?: Date | null;
  summary?: string | null;
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
    out.push({
      title,
      url: link,
      sourceId,
      publishedAt: parsed && !Number.isNaN(parsed.getTime()) ? parsed : null,
      summary: tag(block, "description") ?? tag(block, "summary"),
    });
  }
  return out;
}

export function rssAdapter(opts: { id: string; name: string; feedUrl: string }): SourceAdapter {
  return {
    id: opts.id,
    name: opts.name,
    async fetchListings(fetcher = fetch) {
      const res = await fetcher(opts.feedUrl, { headers: { "user-agent": "SweepTrackBot/0.1 (+https://sweeptrack.app/bot)" } });
      if (!res.ok) throw new Error(`${opts.id}: HTTP ${res.status}`);
      return parseFeed(await res.text(), opts.id);
    },
  };
}
