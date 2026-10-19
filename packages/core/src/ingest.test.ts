import { describe, expect, it } from "vitest";
import {
  extractAnchors,
  frequencyFromCategories,
  htmlToText,
  isAllowedByRobots,
  isLikelySweepsLink,
  parseFeed,
  parseRobots,
  parseRules,
  parseSitemap,
  pickSponsorLink,
} from "./index";

const FEED = `<?xml version="1.0"?><rss><channel><title>Listings</title>
<item>
  <title>Acme Cozy Mattress Giveaway &#8211; Win a Mattress</title>
  <link>https://listings.example/acme-mattress/</link>
  <pubDate>Mon, 19 Oct 2026 15:42:41 +0000</pubDate>
  <category><![CDATA[Single Entry Sweepstakes]]></category>
  <category><![CDATA[Home]]></category>
  <description><![CDATA[Enter to win a mattress.]]></description>
  <content:encoded><![CDATA[<p>Enter to win a mattress from Acme.</p>
  <p><strong>Eligibility:</strong> Open to legal residents of the United States who are 18 years of age or older.</p>
  <p><strong>Sponsor:</strong> Acme Sleep</p>
  <p>Entry Limit: Single Entry. End Date: November 13, 2026 at 11:59 PM MST.</p>
  <p>Prize: One (1) mattress (approximate retail value 1029 USD)</p>
  <p><a href="https://www.facebook.com/sharer.php?u=x">Share</a> <a href="https://acmesleep.example/giveaway?utm_source=listings">Enter Now</a></p>]]></content:encoded>
</item></channel></rss>`;

describe("rich feed parsing", () => {
  const [item] = parseFeed(FEED, "listings");
  it("reads categories, content and decodes entities", () => {
    expect(item!.title).toBe("Acme Cozy Mattress Giveaway – Win a Mattress");
    expect(item!.categories).toEqual(["Single Entry Sweepstakes", "Home"]);
    expect(item!.contentHtml).toContain("Entry Limit");
    expect(frequencyFromCategories(item!.categories!)).toBe("once");
  });
  it("parses listing-style labels", () => {
    const r = parseRules(htmlToText(item!.contentHtml!));
    expect(r.endsAt?.toISOString().slice(0, 10)).toBe("2026-11-13");
    expect(r.frequency).toBe("once");
    expect(r.totalArv).toBe(1029);
    expect(r.countries).toEqual(["US"]);
    expect(r.minAge).toBe(18);
    expect(r.sponsor).toBe("Acme Sleep");
  });
  it("picks the sponsor link over share links", () => {
    const anchors = extractAnchors(item!.contentHtml!, item!.url);
    expect(pickSponsorLink(anchors, item!.url)).toBe("https://acmesleep.example/giveaway?utm_source=listings");
  });
  it("ignores same-site and social links", () => {
    const anchors = extractAnchors(
      `<a href="/other">Enter</a><a href="https://twitter.com/x">Enter</a><a href="https://shop.example/cart">Shop</a>`,
      "https://listings.example/a",
    );
    expect(pickSponsorLink(anchors, "https://listings.example/a")).toBeNull();
  });
});

describe("robots.txt", () => {
  const rules = parseRobots(`User-agent: *\nDisallow: /sweepstakes/\nAllow: /sweepstakes/public$\nDisallow: /*.pdf$\n\nUser-agent: OtherBot\nDisallow: /`);
  it("applies longest-match rules", () => {
    expect(isAllowedByRobots(rules, "/")).toBe(true);
    expect(isAllowedByRobots(rules, "/sweepstakes/win-a-car")).toBe(false);
    expect(isAllowedByRobots(rules, "/sweepstakes/public")).toBe(true);
    expect(isAllowedByRobots(rules, "/rules/file.pdf")).toBe(false);
  });
  it("uses a specific group when one names us", () => {
    const r = parseRobots(`User-agent: *\nDisallow: /\n\nUser-agent: SweepTrackBot\nDisallow: /private\nCrawl-delay: 5`);
    expect(isAllowedByRobots(r, "/listing")).toBe(true);
    expect(r.crawlDelaySeconds).toBe(5);
  });
});

describe("sitemaps & newsletters", () => {
  it("parses urlsets and indexes", () => {
    const s = parseSitemap(`<urlset><url><loc>https://a.example/x</loc><lastmod>2026-10-19T12:26:06-04:00</lastmod></url></urlset>`);
    expect(s).toEqual([{ url: "https://a.example/x", lastmod: new Date("2026-10-19T16:26:06Z"), isIndex: false }]);
    expect(parseSitemap(`<sitemapindex><sitemap><loc>https://a.example/s1.xml</loc></sitemap></sitemapindex>`)[0]!.isIndex).toBe(true);
  });
  it("filters newsletter links", () => {
    expect(isLikelySweepsLink({ url: "https://brand.example/summer-giveaway", text: "Check it out" })).toBe(true);
    expect(isLikelySweepsLink({ url: "https://news.example/u?id=1", text: "Unsubscribe" })).toBe(false);
    expect(isLikelySweepsLink({ url: "https://brand.example/blog", text: "Our story" })).toBe(false);
  });
});

describe("listing page hygiene", () => {
  it("reads only the main article", async () => {
    const { mainContent } = await import("./listing");
    const html = `<div class="sidebar"><a href="https://other.example/win">Enter</a></div><article>${"<p>Main listing text. </p>".repeat(20)}<a href="https://brand.example/x">Enter Now</a></article><aside>Canada</aside>`;
    expect(mainContent(html)).not.toContain("other.example");
    expect(mainContent(html)).toContain("brand.example");
  });
  it("rejects sponsor pages for a different promotion", async () => {
    const { pageMatchesListing } = await import("./listing");
    expect(pageMatchesListing("NapLab Mattress Giveaway", { url: "https://kingsumo.com/g/x/timeless-beauty", title: "Timeless Beauty Giveaway", text: "Win skincare" })).toBe(false);
    expect(pageMatchesListing("NapLab Mattress Giveaway", { url: "https://naplab.example/win", title: "Win a CoolNest mattress", text: "" })).toBe(true);
  });
  it("strips addresses from sponsor names", () => {
    expect(parseRules("Sponsor: JMR Rebuilders 113 Wicker Hill Rd, Peachtree City, GA 30269\nOther").sponsor).toBe("JMR Rebuilders");
    expect(parseRules("Sponsor: Carter Vintage Guitars, located at 606 8th Ave S\nOther").sponsor).toBe("Carter Vintage Guitars");
    expect(parseRules("Sponsor: Restoration 225 Inc., PO BOX 578, Lakeside, CA 92040\nOther").sponsor).toBe("Restoration 225 Inc.");
  });
});
