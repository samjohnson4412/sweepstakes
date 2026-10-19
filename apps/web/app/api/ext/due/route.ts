import { withApiUser } from "@/lib/api";
import { getTrackedRows } from "@/lib/sweeps";

export const GET = withApiUser(async (_req, user) => {
  const rows = await getTrackedRows(user.id);
  return Response.json({
    due: rows
      .filter((r) => r.due)
      .map((r) => ({
        sweepstakesId: r.sweepstakesId,
        title: r.title,
        url: r.url,
        endsAt: r.endsAt,
        profileId: r.profileId,
        profileName: r.profileName,
      })),
  });
});
