import { z } from "zod";
import { withApiUser } from "@/lib/api";
import { importSweepstakes, trackSweepstakes } from "@/lib/sweeps";

/** "Add this page" from the extension. */
export const POST = withApiUser(async (req, user) => {
  const parsed = z.object({ url: z.string().url(), title: z.string().max(200).optional() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid body" }, { status: 400 });
  const result = await importSweepstakes(parsed.data.url, { userId: user.id, sourceId: "extension", title: parsed.data.title });
  await trackSweepstakes(user.id, result.id);
  return Response.json({ ok: true, sweepstakesId: result.id, created: result.created, warning: result.warning ?? null });
});
