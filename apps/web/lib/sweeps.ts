import { mailByDate, nextEligibleAt, type Frequency } from "@sweeptrack/core";
import {
  amoeEntries,
  and,
  db,
  entrantProfiles,
  entries,
  eq,
  ne,
  sql,
  sweepstakes,
  trackedProfiles,
  trackedSweepstakes,
} from "@sweeptrack/db";
export { importSweepstakes } from "@sweeptrack/ingest";

/** Track a catalog item for a user; defaults to entering with all of the user's profiles. */
export async function trackSweepstakes(userId: string, sweepstakesId: string, profileIds?: string[]): Promise<string> {
  const [tracked] = await db
    .insert(trackedSweepstakes)
    .values({ userId, sweepstakesId })
    .onConflictDoUpdate({ target: [trackedSweepstakes.userId, trackedSweepstakes.sweepstakesId], set: { status: "active" } })
    .returning();
  const ids =
    profileIds ??
    (await db.select({ id: entrantProfiles.id }).from(entrantProfiles).where(eq(entrantProfiles.userId, userId))).map((p) => p.id);
  if (ids.length) {
    await db
      .insert(trackedProfiles)
      .values(ids.map((profileId) => ({ trackedId: tracked!.id, profileId })))
      .onConflictDoNothing();
  }
  return tracked!.id;
}

export interface TrackedRow {
  trackedId: string;
  sweepstakesId: string;
  title: string;
  url: string;
  sponsor: string | null;
  endsAt: Date | null;
  startsAt: Date | null;
  frequency: Frequency;
  sponsorTz: string;
  totalArvCents: number | null;
  profileId: string;
  profileName: string;
  lastEntryAt: Date | null;
  nextEligibleAt: Date | null;
  due: boolean;
}

/** Every (tracked sweepstakes × entering profile) for a user, with entry status. */
export async function getTrackedRows(userId: string, now = new Date()): Promise<TrackedRow[]> {
  const rows = await db
    .select({
      trackedId: trackedSweepstakes.id,
      sweepstakesId: sweepstakes.id,
      title: sweepstakes.title,
      url: sweepstakes.url,
      sponsor: sweepstakes.sponsor,
      endsAt: sweepstakes.endsAt,
      startsAt: sweepstakes.startsAt,
      frequency: sql<Frequency>`coalesce(${trackedSweepstakes.frequencyOverride}, ${sweepstakes.frequency})`,
      sponsorTz: sweepstakes.sponsorTz,
      totalArvCents: sweepstakes.totalArvCents,
      profileId: entrantProfiles.id,
      firstName: entrantProfiles.firstName,
      lastName: entrantProfiles.lastName,
      lastEntryAt: sql<string | null>`max(${entries.enteredAt})`,
    })
    .from(trackedSweepstakes)
    .innerJoin(sweepstakes, eq(sweepstakes.id, trackedSweepstakes.sweepstakesId))
    .innerJoin(trackedProfiles, eq(trackedProfiles.trackedId, trackedSweepstakes.id))
    .innerJoin(entrantProfiles, eq(entrantProfiles.id, trackedProfiles.profileId))
    .leftJoin(
      entries,
      and(
        eq(entries.userId, trackedSweepstakes.userId),
        eq(entries.sweepstakesId, sweepstakes.id),
        eq(entries.profileId, entrantProfiles.id),
        ne(entries.method, "amoe"),
      ),
    )
    .where(and(eq(trackedSweepstakes.userId, userId), eq(trackedSweepstakes.status, "active")))
    .groupBy(trackedSweepstakes.id, sweepstakes.id, entrantProfiles.id)
    .orderBy(sweepstakes.endsAt);

  return rows.map((r) => {
    const lastEntryAt = r.lastEntryAt ? new Date(r.lastEntryAt) : null;
    const input = { frequency: r.frequency, lastEntryAt, sponsorTz: r.sponsorTz, startsAt: r.startsAt, endsAt: r.endsAt };
    const next = nextEligibleAt(input);
    const ended = r.endsAt !== null && r.endsAt < now;
    const notStarted = r.startsAt !== null && r.startsAt > now;
    const due =
      !ended && !notStarted && next !== null && next <= now && r.frequency !== "unlimited" && r.frequency !== "per_purchase";
    return {
      trackedId: r.trackedId,
      sweepstakesId: r.sweepstakesId,
      title: r.title,
      url: r.url,
      sponsor: r.sponsor,
      endsAt: r.endsAt,
      startsAt: r.startsAt,
      frequency: r.frequency,
      sponsorTz: r.sponsorTz,
      totalArvCents: r.totalArvCents,
      profileId: r.profileId,
      profileName: `${r.firstName} ${r.lastName}`,
      lastEntryAt,
      nextEligibleAt: next,
      due,
    };
  });
}

/** Log an entry after verifying the profile belongs to the user. Returns false if not allowed. */
export async function logEntry(input: {
  userId: string;
  sweepstakesId: string;
  profileId: string;
  method?: "online" | "social" | "text" | "instant_win";
  source?: "web" | "extension" | "email";
}): Promise<boolean> {
  const profile = await db.query.entrantProfiles.findFirst({
    where: and(eq(entrantProfiles.id, input.profileId), eq(entrantProfiles.userId, input.userId)),
  });
  if (!profile) return false;
  await db.insert(entries).values({
    userId: input.userId,
    sweepstakesId: input.sweepstakesId,
    profileId: input.profileId,
    method: input.method ?? "online",
    source: input.source ?? "web",
  });
  return true;
}

/** Plan a mail-in entry, computing mail-by from the parsed AMOE deadline (or the end date). */
export async function planAmoe(userId: string, sweepstakesId: string, profileId: string, stampCents: number) {
  const sw = await db.query.sweepstakes.findFirst({ where: eq(sweepstakes.id, sweepstakesId) });
  const profile = await db.query.entrantProfiles.findFirst({
    where: and(eq(entrantProfiles.id, profileId), eq(entrantProfiles.userId, userId)),
  });
  if (!sw || !profile) return null;
  const deadlineRaw = sw.amoe?.deadline ?? sw.endsAt;
  const deadline = deadlineRaw ? new Date(deadlineRaw) : null;
  const deadlineType = sw.amoe?.deadlineType ?? "unknown";
  const stamps = sw.amoe?.sasRequired ? 2 : 1;
  const [row] = await db
    .insert(amoeEntries)
    .values({
      userId,
      sweepstakesId,
      profileId,
      deadline: deadline ? deadline.toISOString().slice(0, 10) : null,
      deadlineType,
      mailBy: deadline ? mailByDate(deadline, deadlineType).toISOString().slice(0, 10) : null,
      postageCents: stampCents * stamps,
    })
    .returning();
  return row;
}
