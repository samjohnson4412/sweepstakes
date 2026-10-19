"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  amoeEntries,
  and,
  apiTokens,
  db,
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
