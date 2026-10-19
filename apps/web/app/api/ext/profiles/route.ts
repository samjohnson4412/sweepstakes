import { db, entrantProfiles, eq } from "@sweeptrack/db";
import { withApiUser } from "@/lib/api";

export const GET = withApiUser(async (_req, user) => {
  const profiles = await db.select().from(entrantProfiles).where(eq(entrantProfiles.userId, user.id)).orderBy(entrantProfiles.createdAt);
  return Response.json({
    profiles: profiles.map(({ userId: _u, createdAt: _c, ...p }) => p),
  });
});
