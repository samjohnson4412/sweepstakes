/** IRS threshold at which sponsors generally issue a 1099-MISC for prizes. */
export const FORM_1099_THRESHOLD_CENTS = 600_00;

export function expects1099(arvCents: number): boolean {
  return arvCents >= FORM_1099_THRESHOLD_CENTS;
}

export interface WinForTax {
  prize: string;
  sponsor: string | null;
  arvCents: number;
  receivedAt: Date | null;
  status: string;
}

/** Wins that count toward a tax year: received (or claimed) in that year, not forfeited/declined. */
export function taxYearWins<T extends WinForTax>(wins: T[], year: number): T[] {
  return wins.filter(
    (w) => w.receivedAt && w.receivedAt.getUTCFullYear() === year && !["forfeited", "declined"].includes(w.status),
  );
}

function csvCell(v: string | number | null): string {
  const s = v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function winsToCsv(wins: WinForTax[]): string {
  const rows: (string | number | null)[][] = [["Prize", "Sponsor", "ARV (USD)", "Received", "1099 expected"]];
  let total = 0;
  for (const w of wins) {
    total += w.arvCents;
    rows.push([
      w.prize,
      w.sponsor,
      (w.arvCents / 100).toFixed(2),
      w.receivedAt?.toISOString().slice(0, 10) ?? null,
      expects1099(w.arvCents) ? "yes" : "no",
    ]);
  }
  rows.push(["TOTAL", null, (total / 100).toFixed(2), null, null]);
  return rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}
