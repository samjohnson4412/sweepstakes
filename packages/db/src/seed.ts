import { canonicalUrl, mailByDate } from "@sweeptrack/core";
import { db, getPool } from "./client";
import { entrantProfiles, trackedProfiles, trackedSweepstakes, sweepstakes, users, amoeEntries, wins } from "./schema";
import { hashPassword, randomToken } from "./password";

const DEMO_EMAIL = "demo@sweeptrack.local";
const DEMO_PASSWORD = "demo-password";

const existing = await db.query.users.findFirst({ where: (u, { eq }) => eq(u.email, DEMO_EMAIL) });
if (existing) {
  console.log(`Seed skipped: ${DEMO_EMAIL} already exists`);
} else {
  const [user] = await db
    .insert(users)
    .values({ email: DEMO_EMAIL, passwordHash: await hashPassword(DEMO_PASSWORD), name: "Demo", inboundToken: randomToken(9).toLowerCase() })
    .returning();
  const [profile] = await db
    .insert(entrantProfiles)
    .values({
      userId: user!.id, firstName: "Pat", lastName: "Demo", email: "pat@example.com", phone: "555-0100",
      address1: "1 Elm St", city: "Austin", state: "TX", zip: "78701", birthDate: "1990-09-10", isDefault: true,
    })
    .returning();

  const day = 86_400_000;
  const now = Date.now();
  const samples = [
    { title: "Summer Grill Giveaway", url: "https://example.com/grill", frequency: "daily" as const, ends: 20, arv: 2450_00, sponsor: "Acme Outdoor Co." },
    { title: "Dream Kitchen Sweepstakes", url: "https://example.com/kitchen", frequency: "daily" as const, ends: 4, arv: 25000_00, sponsor: "HomeCo" },
    { title: "Weekly Gift Card Drop", url: "https://example.com/giftcard", frequency: "weekly" as const, ends: 60, arv: 100_00, sponsor: "ShopMart" },
    { title: "Trip to Hawaii", url: "https://example.com/hawaii", frequency: "once" as const, ends: 45, arv: 8000_00, sponsor: "TravelCo" },
  ];
  for (const s of samples) {
    const endsAt = new Date(now + s.ends * day);
    const [row] = await db
      .insert(sweepstakes)
      .values({
        canonicalUrl: canonicalUrl(s.url), url: s.url, title: s.title, sponsor: s.sponsor, totalArvCents: s.arv,
        frequency: s.frequency, endsAt, countries: ["US"], minAge: 18,
        amoe: s.frequency === "once" ? {
          available: true, address: "Trip to Hawaii AMOE, PO Box 1, Anytown, NY 10001", deadlineType: "received_by",
          deadline: endsAt, handwrittenRequired: true, cardSize: "3x5", sasRequired: false, limitPerEnvelope: 1,
          thirdPartyAllowed: "no", mechanicalReproductionAllowed: "no",
        } : null,
      })
      .returning();
    const [tracked] = await db.insert(trackedSweepstakes).values({ userId: user!.id, sweepstakesId: row!.id }).returning();
    await db.insert(trackedProfiles).values({ trackedId: tracked!.id, profileId: profile!.id });
    if (s.frequency === "once") {
      await db.insert(amoeEntries).values({
        userId: user!.id, sweepstakesId: row!.id, profileId: profile!.id, deadline: endsAt.toISOString().slice(0, 10),
        deadlineType: "received_by", mailBy: mailByDate(endsAt, "received_by").toISOString().slice(0, 10), postageCents: 78,
      });
    }
  }
  await db.insert(wins).values({
    userId: user!.id, profileId: profile!.id, prize: "$50 gift card", sponsor: "ShopMart", arvCents: 50_00,
    status: "received", receivedAt: new Date(now - 30 * day).toISOString().slice(0, 10),
  });
  console.log(`Seeded ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}
await getPool().end();
