import { canonicalUrl } from "@sweeptrack/core";
import { db, eq, sweepstakes } from "@sweeptrack/db";
import { withApiUser } from "@/lib/api";
import { getTrackedRows } from "@/lib/sweeps";

/** Is the page the extension is on a sweepstakes this user tracks? */
export const GET = withApiUser(async (req, user) => {
  const url = new URL(req.url).searchParams.get("url");
  if (!url) return Response.json({ error: "url required" }, { status: 400 });
  let canonical: string;
  try {
    canonical = canonicalUrl(url);
  } catch {
    return Response.json({ error: "invalid url" }, { status: 400 });
  }
  const s = await db.query.sweepstakes.findFirst({ where: eq(sweepstakes.canonicalUrl, canonical) });
  if (!s) return Response.json({ match: null });
  const rows = (await getTrackedRows(user.id)).filter((r) => r.sweepstakesId === s.id);
  return Response.json({
    match: {
      sweepstakesId: s.id,
      title: s.title,
      tracked: rows.length > 0,
      profiles: rows.map((r) => ({ profileId: r.profileId, profileName: r.profileName, due: r.due, nextEligibleAt: r.nextEligibleAt })),
    },
  });
});
