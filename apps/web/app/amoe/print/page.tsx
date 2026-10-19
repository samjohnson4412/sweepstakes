import { amoeEntries, and, db, entrantProfiles, eq, inArray, sweepstakes } from "@sweeptrack/db";
import { AmoePrintSheet } from "@/components/AmoePrintSheet";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AmoePrint({ searchParams }: { searchParams: Promise<{ id?: string | string[] }> }) {
  const user = await requireUser();
  const raw = (await searchParams).id;
  const ids = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  const rows = ids.length
    ? await db
        .select({ a: amoeEntries, s: sweepstakes, p: entrantProfiles })
        .from(amoeEntries)
        .innerJoin(sweepstakes, eq(sweepstakes.id, amoeEntries.sweepstakesId))
        .innerJoin(entrantProfiles, eq(entrantProfiles.id, amoeEntries.profileId))
        .where(and(eq(amoeEntries.userId, user.id), inArray(amoeEntries.id, ids)))
    : [];

  return (
    <div>
      <div className="no-print notice">
        {rows.length} entr{rows.length === 1 ? "y" : "ies"}. Use your browser&apos;s Print (set margins to “None”). If the
        rules require hand-printed entries, copy these by hand instead of mailing the printout.
      </div>
      <AmoePrintSheet rows={rows} />
    </div>
  );
}
