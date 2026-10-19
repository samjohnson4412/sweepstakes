import { taxYearWins, winsToCsv } from "@sweeptrack/core";
import { db, eq, wins } from "@sweeptrack/db";
import { getCurrentUser } from "@/lib/auth";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const year = Number(new URL(req.url).searchParams.get("year")) || new Date().getUTCFullYear();
  const rows = await db.select().from(wins).where(eq(wins.userId, user.id));
  const csv = winsToCsv(
    taxYearWins(
      rows.map((w) => ({ ...w, receivedAt: w.receivedAt ? new Date(`${w.receivedAt}T12:00:00Z`) : null })),
      year,
    ),
  );
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="sweepstakes-wins-${year}.csv"`,
    },
  });
}
