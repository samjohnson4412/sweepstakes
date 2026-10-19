"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  amoeEntries,
  and,
  apiTokens,
  db,
  inArray,
  sources,
  sweepstakes,
  entrantProfiles,
  eq,
  hashPassword,
  inboundMessages,
  randomToken,
  trackedSweepstakes,
  users,
  verifyPassword,
  wins,
} from "@sweeptrack/db";
import { FREQUENCIES, US_STATES } from "@sweeptrack/core";
import { disconnectMailAccount, endOfDay, enqueue } from "@sweeptrack/ingest";
import { isAdmin, mailServiceEnabled, requireAdmin } from "@/lib/admin";
import { createApiToken, createSession, destroySession, requireUser } from "@/lib/auth";
import { importSweepstakes, logEntry, planAmoe, trackSweepstakes } from "@/lib/sweeps";

/** Current USPS First-Class Forever stamp price, in cents. Make this a user setting later. */
const DEFAULT_STAMP_CENTS = 78;

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
};

export type FormState = { error?: string; message?: string; token?: string } | undefined;

// ---------- Auth ----------

const credentials = z.object({ email: z.string().email().toLowerCase(), password: z.string().min(8, "Password must be at least 8 characters") });

export async function signup(_: FormState, fd: FormData): Promise<FormState> {
  const parsed = credentials.safeParse({ email: str(fd, "email"), password: str(fd, "password") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const exists = await db.query.users.findFirst({ where: eq(users.email, parsed.data.email) });
  if (exists) return { error: "An account with that email already exists" };
  const [user] = await db
    .insert(users)
    .values({
      email: parsed.data.email,
      passwordHash: await hashPassword(parsed.data.password),
      name: str(fd, "name"),
      inboundToken: randomToken(9).toLowerCase().replace(/[^a-z0-9]/g, "x"),
    })
    .returning();
  await createSession(user!.id);
  redirect("/settings?welcome=1");
}

export async function login(_: FormState, fd: FormData): Promise<FormState> {
  const parsed = credentials.safeParse({ email: str(fd, "email"), password: str(fd, "password") });
  if (!parsed.success) return { error: "Invalid email or password" };
  const user = await db.query.users.findFirst({ where: eq(users.email, parsed.data.email) });
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) return { error: "Invalid email or password" };
  await createSession(user.id);
  redirect("/dashboard");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}

// ---------- Sweepstakes ----------

export async function addSweepstakes(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const url = z.string().url().safeParse(str(fd, "url"));
  if (!url.success) return { error: "Enter a valid URL (https://…)" };
  const result = await importSweepstakes(url.data, { userId: user.id, title: str(fd, "title") ?? undefined });
  await trackSweepstakes(user.id, result.id);
  revalidatePath("/sweepstakes");
  revalidatePath("/dashboard");
  if (result.warning) return { message: `Added. ${result.warning}` };
  redirect(`/sweepstakes/${result.id}`);
}

export async function markEntered(fd: FormData) {
  const user = await requireUser();
  const sweepstakesId = str(fd, "sweepstakesId");
  const profileId = str(fd, "profileId");
  if (sweepstakesId && profileId) await logEntry({ userId: user.id, sweepstakesId, profileId });
  revalidatePath("/dashboard");
  revalidatePath(`/sweepstakes/${sweepstakesId}`);
}

export async function setTrackedStatus(fd: FormData) {
  const user = await requireUser();
  const id = str(fd, "trackedId");
  const status = z.enum(["active", "paused", "ended", "hidden"]).safeParse(str(fd, "status"));
  if (!id || !status.success) return;
  await db
    .update(trackedSweepstakes)
    .set({ status: status.data })
    .where(and(eq(trackedSweepstakes.id, id), eq(trackedSweepstakes.userId, user.id)));
  revalidatePath("/sweepstakes");
  revalidatePath("/dashboard");
}

export async function setFrequencyOverride(fd: FormData) {
  const user = await requireUser();
  const id = str(fd, "trackedId");
  const raw = str(fd, "frequency");
  const freq = z.enum(["once", "daily", "daily_24h", "weekly", "monthly", "unlimited", "per_purchase"]).nullable().safeParse(raw);
  if (!id || !freq.success) return;
  await db
    .update(trackedSweepstakes)
    .set({ frequencyOverride: freq.data })
    .where(and(eq(trackedSweepstakes.id, id), eq(trackedSweepstakes.userId, user.id)));
  revalidatePath("/sweepstakes", "layout");
  revalidatePath("/dashboard");
}

// ---------- AMOE ----------

export async function planAmoeAction(fd: FormData) {
  const user = await requireUser();
  const sweepstakesId = str(fd, "sweepstakesId");
  const profileId = str(fd, "profileId");
  if (sweepstakesId && profileId) await planAmoe(user.id, sweepstakesId, profileId, DEFAULT_STAMP_CENTS);
  revalidatePath("/amoe");
  revalidatePath(`/sweepstakes/${sweepstakesId}`);
}

export async function setAmoeStatus(fd: FormData) {
  const user = await requireUser();
  const id = str(fd, "id");
  const status = z.enum(["planned", "prepared", "mailed", "confirmed", "skipped"]).safeParse(str(fd, "status"));
  if (!id || !status.success) return;
  await db
    .update(amoeEntries)
    .set({ status: status.data, mailedAt: status.data === "mailed" ? new Date() : undefined })
    .where(and(eq(amoeEntries.id, id), eq(amoeEntries.userId, user.id)));
  revalidatePath("/amoe");
  revalidatePath("/dashboard");
}

// ---------- Wins ----------

const dateOrNull = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();

export async function saveWin(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = z
    .object({
      id: z.string().uuid().nullable(),
      prize: z.string().min(1, "Prize is required").max(200),
      sponsor: z.string().max(200).nullable(),
      arv: z.coerce.number().min(0).default(0),
      status: z.enum(["notified", "claimed", "received", "forfeited", "declined"]),
      notifiedAt: dateOrNull,
      claimDeadline: dateOrNull,
      receivedAt: dateOrNull,
      notes: z.string().max(2000).nullable(),
    })
    .safeParse({
      id: str(fd, "id"),
      prize: str(fd, "prize"),
      sponsor: str(fd, "sponsor"),
      arv: str(fd, "arv") ?? 0,
      status: str(fd, "status") ?? "notified",
      notifiedAt: str(fd, "notifiedAt"),
      claimDeadline: str(fd, "claimDeadline"),
      receivedAt: str(fd, "receivedAt"),
      notes: str(fd, "notes"),
    });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { id, arv, ...rest } = parsed.data;
  const values = {
    ...rest,
    arvCents: Math.round(arv * 100),
    affidavitSubmitted: fd.get("affidavitSubmitted") === "on",
    w9Submitted: fd.get("w9Submitted") === "on",
  };
  if (id) {
    await db.update(wins).set(values).where(and(eq(wins.id, id), eq(wins.userId, user.id)));
  } else {
    await db.insert(wins).values({ ...values, userId: user.id });
  }
  revalidatePath("/wins");
  revalidatePath("/dashboard");
  return { message: "Saved" };
}

// ---------- Inbox ----------

export async function dismissMessage(fd: FormData) {
  const user = await requireUser();
  const id = str(fd, "id");
  if (!id) return;
  await db.update(inboundMessages).set({ dismissed: true }).where(and(eq(inboundMessages.id, id), eq(inboundMessages.userId, user.id)));
  revalidatePath("/inbox");
  revalidatePath("/dashboard");
}

export async function importLink(fd: FormData) {
  const user = await requireUser();
  const url = z.string().url().safeParse(str(fd, "url"));
  if (!url.success) return;
  const result = await importSweepstakes(url.data, { userId: user.id, sourceId: "email" });
  await trackSweepstakes(user.id, result.id);
  revalidatePath("/inbox");
  revalidatePath("/sweepstakes");
}

// ---------- Settings ----------

export async function saveProfile(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = z
    .object({
      id: z.string().uuid().nullable(),
      firstName: z.string().min(1, "First name is required").max(100),
      lastName: z.string().min(1, "Last name is required").max(100),
      email: z.string().email("Valid email is required"),
      phone: z.string().max(40).nullable(),
      address1: z.string().max(200).nullable(),
      address2: z.string().max(200).nullable(),
      city: z.string().max(100).nullable(),
      state: z.string().max(50).nullable(),
      zip: z.string().max(20).nullable(),
      birthDate: dateOrNull,
    })
    .safeParse(Object.fromEntries(["id", "firstName", "lastName", "email", "phone", "address1", "address2", "city", "state", "zip", "birthDate"].map((k) => [k, str(fd, k)])));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { id, ...values } = parsed.data;
  if (id) {
    await db.update(entrantProfiles).set(values).where(and(eq(entrantProfiles.id, id), eq(entrantProfiles.userId, user.id)));
  } else {
    const count = (await db.select({ id: entrantProfiles.id }).from(entrantProfiles).where(eq(entrantProfiles.userId, user.id))).length;
    const limit = user.plan === "pro" ? 5 : 1;
    if (count >= limit) return { error: `Your plan allows ${limit} entrant profile${limit > 1 ? "s" : ""}. Upgrade to Pro for household profiles.` };
    await db.insert(entrantProfiles).values({ ...values, userId: user.id, isDefault: count === 0 });
  }
  revalidatePath("/settings");
  return { message: "Profile saved" };
}

export async function createToken(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const token = await createApiToken(user.id, str(fd, "name") ?? "Browser extension");
  revalidatePath("/settings");
  return { token };
}

export async function revokeToken(fd: FormData) {
  const user = await requireUser();
  const id = str(fd, "id");
  if (id) await db.delete(apiTokens).where(and(eq(apiTokens.id, id), eq(apiTokens.userId, user.id)));
  revalidatePath("/settings");
}

// ---------- Catalog ----------

export async function trackFromCatalog(fd: FormData) {
  const user = await requireUser();
  const id = z.string().uuid().safeParse(str(fd, "sweepstakesId"));
  if (!id.success) return;
  await trackSweepstakes(user.id, id.data);
  revalidatePath("/catalog");
  revalidatePath("/dashboard");
  revalidatePath("/sweepstakes");
}

const STATE_CODES = new Set(Object.values(US_STATES));

/** Correct catalog details. Allowed for admins and the user who submitted the item. */
export async function editSweepstakes(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const id = z.string().uuid().safeParse(str(fd, "id"));
  if (!id.success) return { error: "Missing id" };
  const row = await db.query.sweepstakes.findFirst({ where: eq(sweepstakes.id, id.data) });
  if (!row) return { error: "Not found" };
  if (!isAdmin(user) && row.submittedByUserId !== user.id) return { error: "Only the person who added this (or an admin) can edit it." };

  const parsed = z
    .object({
      title: z.string().min(1).max(300),
      url: z.string().url(),
      rulesUrl: z.string().url().nullable(),
      sponsor: z.string().max(200).nullable(),
      startsAt: dateOrNull,
      endsAt: dateOrNull,
      frequency: z.enum(FREQUENCIES),
      arv: z.coerce.number().min(0).nullable(),
      minAge: z.coerce.number().int().min(0).max(30).nullable(),
      excludedStates: z.string().max(200).nullable(),
      amoeAddress: z.string().max(400).nullable(),
      amoeDeadline: dateOrNull,
      amoeDeadlineType: z.enum(["postmarked_by", "received_by", "unknown"]),
      thirdPartyAllowed: z.enum(["yes", "no", "unknown"]),
    })
    .safeParse(
      Object.fromEntries(
        ["title", "url", "rulesUrl", "sponsor", "startsAt", "endsAt", "frequency", "arv", "minAge", "excludedStates", "amoeAddress", "amoeDeadline", "amoeDeadlineType", "thirdPartyAllowed"].map(
          (k) => [k, str(fd, k)],
        ),
      ),
    );
  if (!parsed.success) return { error: `${parsed.error.issues[0]?.path.join(".")}: ${parsed.error.issues[0]?.message}` };
  const v = parsed.data;
  const states = (v.excludedStates ?? "").split(/[\s,]+/).map((x) => x.toUpperCase()).filter(Boolean);
  const bad = states.filter((x) => !STATE_CODES.has(x));
  if (bad.length) return { error: `Unknown state code(s): ${bad.join(", ")}` };
  const noonUtc = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`) : null);
  const amoeAvailable = Boolean(v.amoeAddress);
  await db
    .update(sweepstakes)
    .set({
      title: v.title,
      url: v.url,
      rulesUrl: v.rulesUrl,
      sponsor: v.sponsor,
      startsAt: noonUtc(v.startsAt),
      endsAt: endOfDay(noonUtc(v.endsAt)),
      frequency: v.frequency,
      totalArvCents: v.arv === null ? null : Math.round(v.arv * 100),
      minAge: v.minAge,
      excludedStates: states.sort(),
      amoe: amoeAvailable
        ? {
            ...(row.amoe ?? {
              handwrittenRequired: false,
              cardSize: null,
              sasRequired: false,
              limitPerEnvelope: null,
              mechanicalReproductionAllowed: "unknown" as const,
            }),
            available: true,
            address: v.amoeAddress,
            deadline: noonUtc(v.amoeDeadline),
            deadlineType: v.amoeDeadlineType,
            thirdPartyAllowed: v.thirdPartyAllowed,
          }
        : null,
      humanEditedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(sweepstakes.id, row.id));
  revalidatePath(`/sweepstakes/${row.id}`);
  return { message: "Saved. Automatic updates won't overwrite your corrections." };
}

// ---------- Mail-on-behalf service (gated; docs/SPEC.md §6.1) ----------

export async function requestMailService(fd: FormData) {
  const user = await requireUser();
  if (!mailServiceEnabled()) return;
  const id = str(fd, "id");
  if (!id || fd.get("authorize") !== "on") return;
  const [row] = await db
    .select({ a: amoeEntries, s: sweepstakes })
    .from(amoeEntries)
    .innerJoin(sweepstakes, eq(sweepstakes.id, amoeEntries.sweepstakesId))
    .where(and(eq(amoeEntries.id, id), eq(amoeEntries.userId, user.id)));
  if (!row || row.a.status !== "planned" || row.s.amoe?.thirdPartyAllowed === "no" || row.s.amoeReview === "rejected") return;
  await db
    .update(amoeEntries)
    .set({ fulfilledBy: "service", serviceStatus: row.s.amoeReview === "approved" ? "queued" : "pending_review", serviceAuthorizedAt: new Date() })
    .where(eq(amoeEntries.id, id));
  revalidatePath("/amoe");
}

export async function cancelMailService(fd: FormData) {
  const user = await requireUser();
  const id = str(fd, "id");
  if (!id) return;
  await db
    .update(amoeEntries)
    .set({ fulfilledBy: "self", serviceStatus: null, serviceAuthorizedAt: null })
    .where(and(eq(amoeEntries.id, id), eq(amoeEntries.userId, user.id), inArray(amoeEntries.serviceStatus, ["pending_review", "queued"])));
  revalidatePath("/amoe");
}

// ---------- Admin ----------

export async function reviewAmoe(fd: FormData) {
  await requireAdmin();
  const id = str(fd, "sweepstakesId");
  const decision = z.enum(["approved", "rejected"]).safeParse(str(fd, "decision"));
  if (!id || !decision.success) return;
  await db.update(sweepstakes).set({ amoeReview: decision.data, amoeReviewNote: str(fd, "note") }).where(eq(sweepstakes.id, id));
  await db
    .update(amoeEntries)
    .set({ serviceStatus: decision.data === "approved" ? "queued" : "rejected", ...(decision.data === "rejected" ? { fulfilledBy: "self" } : {}) })
    .where(and(eq(amoeEntries.sweepstakesId, id), eq(amoeEntries.serviceStatus, "pending_review")));
  revalidatePath("/admin/mail");
}

export async function setServiceStatus(fd: FormData) {
  await requireAdmin();
  const ids = fd.getAll("id").map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  const status = z.enum(["printed", "mailed"]).safeParse(str(fd, "status"));
  if (!ids.length || !status.success) return;
  await db
    .update(amoeEntries)
    .set(status.data === "mailed" ? { serviceStatus: "mailed", status: "mailed", mailedAt: new Date() } : { serviceStatus: "printed", status: "prepared" })
    .where(and(inArray(amoeEntries.id, ids), eq(amoeEntries.fulfilledBy, "service")));
  revalidatePath("/admin/mail");
}

export async function updateSource(fd: FormData) {
  await requireAdmin();
  const id = str(fd, "id");
  if (!id) return;
  await db
    .update(sources)
    .set({
      enabled: fd.get("enabled") === "on",
      respectRobots: fd.get("respectRobots") === "on",
      followSponsor: fd.get("followSponsor") === "on",
      intervalMinutes: Math.max(30, Number(str(fd, "intervalMinutes")) || 360),
      maxItemsPerRun: Math.min(200, Math.max(1, Number(str(fd, "maxItemsPerRun")) || 40)),
    })
    .where(eq(sources.id, id));
  revalidatePath("/admin");
}

export async function runSourceNow(fd: FormData) {
  await requireAdmin();
  const id = str(fd, "id");
  if (id) await enqueue("run-source", { sourceId: id });
  revalidatePath("/admin");
}

export async function addSource(_: FormState, fd: FormData): Promise<FormState> {
  await requireAdmin();
  const parsed = z
    .object({ id: z.string().regex(/^[a-z0-9-]{2,40}$/, "id: lowercase letters, digits, dashes"), name: z.string().min(2).max(100), kind: z.enum(["rss", "sitemap"]), url: z.string().url() })
    .safeParse({ id: str(fd, "id"), name: str(fd, "name"), kind: str(fd, "kind"), url: str(fd, "url") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const [row] = await db.insert(sources).values({ ...parsed.data, enabled: true }).onConflictDoNothing().returning();
  revalidatePath("/admin");
  return row ? { message: "Source added" } : { error: "A source with that id already exists" };
}

// ---------- Connected mailboxes ----------

export async function disconnectMail(fd: FormData) {
  const user = await requireUser();
  const id = str(fd, "id");
  if (id) await disconnectMailAccount(user.id, id);
  revalidatePath("/settings");
  revalidatePath("/inbox");
}
