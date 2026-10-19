import { z } from "zod";
import { withApiUser } from "@/lib/api";
import { logEntry } from "@/lib/sweeps";

const body = z.object({
  sweepstakesId: z.string().uuid(),
  profileId: z.string().uuid(),
  method: z.enum(["online", "social", "text", "instant_win"]).optional(),
});

export const POST = withApiUser(async (req, user) => {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid body" }, { status: 400 });
  const ok = await logEntry({ userId: user.id, ...parsed.data, source: "extension" });
  return ok ? Response.json({ ok: true }) : Response.json({ error: "profile not found" }, { status: 404 });
});
