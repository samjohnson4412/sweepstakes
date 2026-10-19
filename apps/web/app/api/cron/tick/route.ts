import { runTick } from "@sweeptrack/ingest";
import { secretMatches } from "@/lib/secrets";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Background work: mailbox sync, queued jobs (newsletter links, re-crawls), and due
 * catalog sources. Cloud Scheduler calls this every 10 minutes with
 * `Authorization: Bearer $CRON_SECRET`; set Cloud Run's request timeout above the budget.
 */
export async function POST(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secretMatches(token, process.env.CRON_SECRET)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const budget = Number(process.env.TICK_BUDGET_MS) || 240_000;
  return Response.json(await runTick(budget));
}
