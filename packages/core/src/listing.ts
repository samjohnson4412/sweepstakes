import type { Frequency } from "./types";
import { htmlToText } from "./rules-parser";

export interface Anchor {
  url: string;
  text: string;
}

/** All absolute http(s) links in an HTML fragment, with their visible text. */
export function extractAnchors(html: string, baseUrl: string): Anchor[] {
  const out: Anchor[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url: string;
    try {
      url = new URL(m[1]!.replace(/&amp;/g, "&"), baseUrl).toString();
    } catch {
      continue;
    }
    if (!/^https?:/i.test(url)) continue;
    const text = htmlToText(m[2] ?? "").slice(0, 200);
    const key = `${url} ${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ url, text });
  }
  return out;
}

const NON_SPONSOR_HOSTS =
  /(^|\.)(facebook|fb|twitter|x|pinterest|instagram|youtube|youtu|tiktok|reddit|linkedin|google|googleapis|gstatic|doubleclick|googlesyndication|amazon-adsystem|wordpress|wp|gravatar|gmpg|feedburner|addtoany|sharethis|addthis|disqus|apple|bit|tumblr|whatsapp|telegram|t|mailchimp|list-manage|w3|schema|creativecommons|cloudflare|jquery|bootstrapcdn)\.[a-z.]+$/i;

function siteOf(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, "").split(".");
  return parts.slice(-2).join(".");
}

/**
 * Pick the link on a listing page that most likely leads to the sponsor's entry page.
 * Returns null when nothing looks like an outbound sweepstakes link.
 */
export function pickSponsorLink(anchors: Anchor[], listingUrl: string): string | null {
  const listingSite = siteOf(new URL(listingUrl).hostname);
  let best: { url: string; score: number } | null = null;
  for (const a of anchors) {
    const u = new URL(a.url);
    if (siteOf(u.hostname) === listingSite || NON_SPONSOR_HOSTS.test(u.hostname)) continue;
    const text = a.text.toLowerCase();
    const href = a.url.toLowerCase();
    let score = 0;
    if (/\b(enter( now| here| to win| the (sweepstakes|giveaway|contest))?|click here to enter|go to (the )?(sweep|giveaway|contest|entry)|visit (the )?(sweep|giveaway|contest|site)|entry (page|form)|sweepstakes page|play now)\b/.test(text)) score += 10;
    if (/official rules|^rules$/.test(text)) score += 4;
    if (/sweep|giveaway|contest|promo|instantwin|instant-win|\bwin\b|enter/.test(href)) score += 3;
    if (/rules|terms/.test(href)) score += 1;
    if (/share|login|signin|account|privacy|cookie|unsubscribe/.test(href)) score -= 6;
    // The mail-in (AMOE) instructions page is not where most users enter.
    if (/alternat|amoe|mail-in|by-mail|no-purchase/.test(href)) score -= 5;
    if (score >= 3 && (!best || score > best.score)) best = { url: a.url, score };
  }
  return best?.url ?? null;
}

/** Heuristic filter for links pulled out of newsletters. */
export function isLikelySweepsLink(a: Anchor): boolean {
  const text = a.text.toLowerCase();
  const href = a.url.toLowerCase();
  if (/unsubscribe|preferences|privacy|view (this )?(email|in browser)|facebook|twitter|instagram|pinterest|mailto:/.test(`${text} ${href}`)) return false;
  return /sweep|giveaway|contest|\bwin\b|enter|instant win|prize/.test(`${text} ${href}`);
}

/** Listing-site category labels often state the entry frequency. */
export function frequencyFromCategories(categories: string[]): Frequency | null {
  const c = categories.join(" | ").toLowerCase();
  if (/daily entr|enter daily|daily sweep/.test(c)) return "daily";
  if (/weekly entr/.test(c)) return "weekly";
  if (/monthly entr/.test(c)) return "monthly";
  if (/single entry|one[- ]time entry|one entry/.test(c)) return "once";
  return null;
}

export interface SitemapEntry {
  url: string;
  lastmod: Date | null;
  /** true when this entry points to another sitemap (sitemap index) */
  isIndex: boolean;
}

export function parseSitemap(xml: string): SitemapEntry[] {
  const isIndex = /<sitemapindex/i.test(xml);
  const out: SitemapEntry[] = [];
  for (const m of xml.matchAll(/<(url|sitemap)>([\s\S]*?)<\/\1>/gi)) {
    const loc = m[2]!.match(/<loc>\s*([^<\s]+)\s*<\/loc>/i)?.[1];
    if (!loc) continue;
    const lm = m[2]!.match(/<lastmod>\s*([^<]+?)\s*<\/lastmod>/i)?.[1];
    const d = lm ? new Date(lm) : null;
    out.push({ url: loc.replace(/&amp;/g, "&"), lastmod: d && !Number.isNaN(d.getTime()) ? d : null, isIndex });
  }
  return out;
}

/**
 * The main article of a listing page, so sidebar / "related giveaways" widgets don't
 * leak other promotions' links and eligibility text. Falls back to the whole page.
 */
export function mainContent(html: string): string {
  const article = html.match(/<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/i)?.[2];
  if (article && article.length > 200) return article;
  const start = html.search(/<[^>]+class=["'][^"']*\b(entry-content|post-content|article-content|listing-content|single-content)\b/i);
  if (start >= 0) {
    const rest = html.slice(start);
    const end = rest.slice(1).search(/<(aside|footer)\b|<[^>]+(class|id)=["'][^"']*\b(sidebar|related|widget|comments)\b/i);
    return end > 0 ? rest.slice(0, end + 1) : rest;
  }
  return html;
}

const TITLE_STOPWORDS = new Set(
  "giveaway giveaways sweepstakes sweeps contest instant game enter entry prize prizes winner winners daily weekly monthly with from your this that their will official rules free chance".split(" "),
);

function significantWords(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/&#?\w+;/g, " ")
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4 && !TITLE_STOPWORDS.has(w)),
  );
}

/** Does a candidate sponsor page plausibly belong to this listing? (guards against sidebar links) */
export function pageMatchesListing(listingTitle: string, page: { url: string; title: string | null; text: string }): boolean {
  const wanted = significantWords(listingTitle);
  if (wanted.size === 0) return true;
  const have = significantWords(`${page.url} ${page.title ?? ""} ${page.text.slice(0, 8000)}`);
  for (const w of wanted) if (have.has(w)) return true;
  return false;
}
