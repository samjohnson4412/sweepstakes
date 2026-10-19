import { amoeCardLines } from "@sweeptrack/core";
import { amoeEntries, and, db, entrantProfiles, eq, inArray, sweepstakes } from "@sweeptrack/db";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Split a one-line address into envelope lines, keeping "City, ST 12345" together. */
function addressLines(address: string): string {
  const parts = address.split(/,\s*/);
  const last = parts.at(-1) ?? "";
  if (parts.length >= 2 && /^[A-Z]{2}\s+\d{5}/.test(last)) parts.splice(-2, 2, `${parts.at(-2)}, ${last}`);
  return parts.join("\n");
}

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
      <div className="print-sheet">
        {rows.map(({ a, s, p }) => {
          const lines = amoeCardLines(p, { includeAge: Boolean(s.minAge) });
          return (
            <div key={a.id} className="stack">
              <div className="card-3x5">
                {lines.map((l, i) => (
                  <div key={i}>{l}</div>
                ))}
              </div>
              <div className="envelope-10">
                <div className="from">
                  {lines.filter((l) => l !== p.phone && l !== p.email && !l.startsWith("Age:")).map((l, i) => (
                    <div key={i}>{l}</div>
                  ))}
                </div>
                <div className="to">{addressLines(s.amoe?.address ?? s.title)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
