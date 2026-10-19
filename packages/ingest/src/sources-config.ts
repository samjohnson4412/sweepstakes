import { db, sources } from "@sweeptrack/db";

export type SourceRow = typeof sources.$inferSelect;

/**
 * Built-in catalog sources. Feeds verified reachable Oct 2026; use is governed by
 * the operator's agreements with each site. ContestGirl's robots.txt disallows
 * /sweepstakes/ and Reddit / Sweepstakes Fanatics block bots, so they aren't listed.
 */
export const DEFAULT_SOURCES: (typeof sources.$inferInsert)[] = [
  {
    id: "online-sweepstakes",
    name: "Online-Sweepstakes.com (RSS)",
    kind: "rss",
    url: "https://online-sweepstakes.com/feed/",
    enabled: true,
    intervalMinutes: 120,
  },
  {
    id: "sweeties-sweeps",
    name: "Sweeties Sweeps (RSS)",
    kind: "rss",
    url: "https://sweetiessweeps.com/feed/",
    enabled: true,
    intervalMinutes: 180,
  },
  {
    id: "sweepsadvantage",
    name: "SweepsAdvantage (new listings sitemap)",
    kind: "sitemap",
    url: "https://www.sweepsadvantage.com/sitemap-new.php",
    enabled: true,
    intervalMinutes: 180,
  },
  {
    id: "newsletter-inbox",
    name: "Newsletter inbox (catalog@ forwarding address)",
    kind: "newsletter",
    url: null,
    enabled: true,
    fetchDetail: false,
  },
];

export async function seedSources(): Promise<number> {
  const rows = await db.insert(sources).values(DEFAULT_SOURCES).onConflictDoNothing().returning();
  return rows.length;
}
