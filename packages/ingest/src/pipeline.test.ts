import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// All test hosts resolve to a public address so the SSRF guard lets them through.
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "93.184.216.34", family: 4 }] }));

import { db, eq, getPool, ingestSeen, inArray, sources, sweepstakes, sweepstakesSources } from "@sweeptrack/db";
import { routeInboundEmail } from "./messages";
import { runSource } from "./pipeline";
import { runJobs } from "./jobs";
import { JOB_HANDLERS } from "./tick";

const RUN = Date.now().toString(36);
const LISTINGS = `listings-${RUN}.example`;
const SPONSOR = `brand-${RUN}.example`;
const OTHER = `other-${RUN}.example`;

const FEED = `<rss><channel>
<item><title>Brand Grill Giveaway</title><link>https://${LISTINGS}/grill/</link>
  <category>Daily Entries</category>
  <description><![CDATA[Win a grill.]]></description>
  <content:encoded><![CDATA[<p>Win a grill.</p><p><a href="https://${SPONSOR}/grill?utm_source=feed">Enter Now</a></p>]]></content:encoded></item>
<item><title>Blocked Listing</title><link>https://${LISTINGS}/private/blocked</link><description>x</description></item>
<item><title>Canada Only Sweeps</title><link>https://${LISTINGS}/canada/</link>
  <content:encoded><![CDATA[<p>Open to legal residents of Canada only, excluding Quebec. Ends December 31, 2026. <a href="https://${OTHER}/ca">Enter here</a></p>]]></content:encoded></item>
</channel></rss>`;

const SPONSOR_PAGE = `<html><head><title>Brand Summer Grill Sweepstakes</title></head><body>
<h1>Win a grill!</h1><a href="/rules">Official Rules</a></body></html>`;
const RULES = `<p>Sponsor: Brand Foods Inc., 1 Main St, Austin, TX 78701.</p>
<p>The Sweepstakes begins on June 1, 2026 and ends on December 15, 2026. Open to legal residents of the fifty (50) United States, 18 years of age or older. Void in Florida.</p>
<p>Limit one (1) entry per person per day.</p><p>Grand Prize: grill (ARV: $900).</p>`;

const pages: Record<string, string> = {
  [`https://${LISTINGS}/robots.txt`]: "User-agent: *\nDisallow: /private/",
  [`https://${LISTINGS}/feed/`]: FEED,
  [`https://${SPONSOR}/robots.txt`]: "",
  [`https://${SPONSOR}/grill?utm_source=feed`]: SPONSOR_PAGE,
  [`https://${SPONSOR}/rules`]: RULES,
  [`https://${OTHER}/ca`]: "<p>Canada only</p>",
  [`https://${OTHER}/promo`]: SPONSOR_PAGE,
};

const realFetch = globalThis.fetch;
const created: string[] = [];

beforeAll(async () => {
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url === `https://click-${RUN}.example/t/1`) return new Response(null, { status: 302, headers: { location: `https://${OTHER}/promo` } });
    const body = pages[url];
    return body === undefined ? new Response("not found", { status: 404 }) : new Response(body, { status: 200 });
  });
  await db.insert(sources).values([
    { id: `test-feed-${RUN}`, name: "Test feed", kind: "rss", url: `https://${LISTINGS}/feed/`, enabled: true },
    { id: `newsletter-${RUN}`, name: "Test newsletter", kind: "newsletter", enabled: true },
  ]);
});

afterAll(async () => {
  vi.stubGlobal("fetch", realFetch);
  const ids = (await db.select({ id: sweepstakesSources.sweepstakesId }).from(sweepstakesSources).where(inArray(sweepstakesSources.sourceId, [`test-feed-${RUN}`, `newsletter-${RUN}`]))).map((r) => r.id);
  if (ids.length) await db.delete(sweepstakes).where(inArray(sweepstakes.id, [...ids, ...created]));
  await db.delete(sources).where(inArray(sources.id, [`test-feed-${RUN}`, `newsletter-${RUN}`]));
  await getPool().end();
});

describe("feed ingestion pipeline", () => {
  it("follows the sponsor link, parses rules, and skips blocked / non-US listings", async () => {
    const summary = await runSource(`test-feed-${RUN}`);
    expect(summary).toMatchObject({ fetched: 3, added: 1, skipped: 2, errors: 0 });

    const row = await db.query.sweepstakes.findFirst({ where: eq(sweepstakes.canonicalUrl, `https://${SPONSOR}/grill`) });
    expect(row).toBeDefined();
    expect(row!.title).toBe("Brand Grill Giveaway");
    expect(row!.sponsor).toBe("Brand Foods Inc.");
    expect(row!.frequency).toBe("daily");
    expect(row!.excludedStates).toEqual(["FL"]);
    expect(row!.totalArvCents).toBe(90000);
    expect(row!.rulesUrl).toBe(`https://${SPONSOR}/rules`);
    expect(row!.categories).toEqual(["Daily Entries"]);
  }, 60_000);

  it("only processes new listings on the next run", async () => {
    const summary = await runSource(`test-feed-${RUN}`);
    expect(summary.processed).toBe(0);
    const seen = await db.select().from(ingestSeen).where(eq(ingestSeen.sourceId, `test-feed-${RUN}`));
    expect(seen).toHaveLength(3);
  });

  it("imports newsletter links through tracking redirects", async () => {
    const res = await routeInboundEmail({
      to: `catalog@${process.env.INBOUND_EMAIL_DOMAIN ?? "in.sweeptrack.local"}`,
      from: "news@sweeps.example",
      subject: "This week's giveaways",
      text: "",
      html: `<a href="https://click-${RUN}.example/t/1">Win a grill giveaway</a> <a href="https://news.example/unsubscribe">Unsubscribe</a>`,
    });
    expect(res).toMatchObject({ ok: true, kind: "catalog", queued: 1 });
    await runJobs(JOB_HANDLERS, 30_000);
    const row = await db.query.sweepstakes.findFirst({ where: eq(sweepstakes.canonicalUrl, `https://${OTHER}/promo`) });
    expect(row?.title).toBe("Brand Summer Grill Sweepstakes");
    if (row) created.push(row.id);
  }, 60_000);
});
