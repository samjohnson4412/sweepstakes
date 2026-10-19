import { amoeEntries, and, db, entrantProfiles, eq, inArray, sweepstakes } from "@sweeptrack/db";
import { AmoePrintSheet } from "@/components/AmoePrintSheet";
import { requireAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

export default async function AdminMailPrint({ searchParams }: { searchParams: Promise<{ id?: string | string[] }> }) {
  await requireAdmin();
  const raw = (await searchParams).id;
  const ids = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  const rows = ids.length
    ? await db
        .select({ a: amoeEntries, s: sweepstakes, p: entrantProfiles })
        .from(amoeEntries)
        .innerJoin(sweepstakes, eq(sweepstakes.id, amoeEntries.sweepstakesId))
        .innerJoin(entrantProfiles, eq(entrantProfiles.id, amoeEntries.profileId))
        .where(and(inArray(amoeEntries.id, ids), eq(amoeEntries.fulfilledBy, "service")))
    : [];
  return <AmoePrintSheet rows={rows} />;
}
