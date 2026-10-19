import { z } from "zod";
import { PROFILE_FIELDS } from "@sweeptrack/core";
import { and, db, eq, fieldMappings, sql } from "@sweeptrack/db";
import { withApiUser } from "@/lib/api";

/** Mappings confirmed by this many different users are shared with everyone. */
const SHARED_THRESHOLD = 2;

const domainSchema = z.string().min(3).max(255).regex(/^[a-z0-9.-]+$/);

/** Learned selector → profile-field mappings for a site: the user's own plus crowd-confirmed ones. */
export const GET = withApiUser(async (req, user) => {
  const domain = domainSchema.safeParse(new URL(req.url).searchParams.get("domain")?.toLowerCase());
  if (!domain.success) return Response.json({ error: "domain required" }, { status: 400 });
  const rows = await db
    .select({
      selector: fieldMappings.selector,
      field: fieldMappings.field,
      users: sql<number>`count(*)::int`,
      mine: sql<boolean>`bool_or(${fieldMappings.userId} = ${user.id})`,
    })
    .from(fieldMappings)
    .where(eq(fieldMappings.domain, domain.data))
    .groupBy(fieldMappings.selector, fieldMappings.field);
  const best = new Map<string, { field: string; score: number }>();
  for (const r of rows) {
    if (!r.mine && r.users < SHARED_THRESHOLD) continue;
    const score = r.users + (r.mine ? 100 : 0);
    if ((best.get(r.selector)?.score ?? -1) < score) best.set(r.selector, { field: r.field, score });
  }
  return Response.json({ mappings: [...best].map(([selector, { field }]) => ({ selector, field })) });
});

const body = z.object({
  domain: domainSchema,
  mappings: z.array(z.object({ selector: z.string().min(1).max(300), field: z.enum(PROFILE_FIELDS) })).max(40),
});

/** Save the fields the user confirmed on this site ("Remember this form"). */
export const POST = withApiUser(async (req, user) => {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid body" }, { status: 400 });
  const { domain, mappings } = parsed.data;
  // Replace this user's previous mappings for the domain.
  await db.delete(fieldMappings).where(and(eq(fieldMappings.domain, domain), eq(fieldMappings.userId, user.id)));
  if (mappings.length) {
    await db
      .insert(fieldMappings)
      .values(mappings.map((m) => ({ domain, selector: m.selector, field: m.field, userId: user.id })))
      .onConflictDoNothing();
  }
  return Response.json({ ok: true, saved: mappings.length });
});
