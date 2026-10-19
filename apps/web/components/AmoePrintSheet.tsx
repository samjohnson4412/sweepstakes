import { amoeCardLines } from "@sweeptrack/core";
import type { amoeEntries, entrantProfiles, sweepstakes } from "@sweeptrack/db";

/** Split a one-line address into envelope lines, keeping "City, ST 12345" together. */
function addressLines(address: string): string {
  const parts = address.split(/,\s*/);
  const last = parts.at(-1) ?? "";
  if (parts.length >= 2 && /^[A-Z]{2}\s+\d{5}/.test(last)) parts.splice(-2, 2, `${parts.at(-2)}, ${last}`);
  return parts.join("\n");
}

export type PrintRow = {
  a: typeof amoeEntries.$inferSelect;
  s: typeof sweepstakes.$inferSelect;
  p: typeof entrantProfiles.$inferSelect;
};

/** 3x5 cards and #10 envelopes for a batch of mail-in entries. */
export function AmoePrintSheet({ rows }: { rows: PrintRow[] }) {
  return (
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
  );
}
