import { describe, expect, it } from "vitest";
import {
  amoeCardLines,
  canonicalUrl,
  chooseOption,
  classifyEmail,
  isDue,
  mailByDate,
  matchField,
  nextEligibleAt,
  parseFeed,
  parseRules,
  profileValue,
  taxYearWins,
  winsToCsv,
} from "./index";

const NY = "America/New_York";

describe("nextEligibleAt", () => {
  it("daily resets at sponsor-local midnight", () => {
    // 2026-03-10 23:30 ET == 2026-03-11 03:30Z
    const last = new Date("2026-03-11T03:30:00Z");
    expect(nextEligibleAt({ frequency: "daily", lastEntryAt: last, sponsorTz: NY })?.toISOString()).toBe(
      "2026-03-11T04:00:00.000Z",
    );
  });

  it("daily handles DST spring-forward", () => {
    // Entry on 2026-03-07 (EST); next midnight 2026-03-08 is still EST (DST starts 2am).
    const last = new Date("2026-03-07T15:00:00Z");
    expect(nextEligibleAt({ frequency: "daily", lastEntryAt: last, sponsorTz: NY })?.toISOString()).toBe(
      "2026-03-08T05:00:00.000Z",
    );
    // Entry on 2026-03-08 (EDT afterwards); next midnight is EDT, offset -4.
    const last2 = new Date("2026-03-08T15:00:00Z");
    expect(nextEligibleAt({ frequency: "daily", lastEntryAt: last2, sponsorTz: NY })?.toISOString()).toBe(
      "2026-03-09T04:00:00.000Z",
    );
  });

  it("daily_24h is rolling", () => {
    const last = new Date("2026-03-11T03:30:00Z");
    expect(nextEligibleAt({ frequency: "daily_24h", lastEntryAt: last })?.toISOString()).toBe("2026-03-12T03:30:00.000Z");
  });

  it("once returns null after entering", () => {
    expect(nextEligibleAt({ frequency: "once", lastEntryAt: new Date() })).toBeNull();
  });

  it("monthly rolls over to the 1st", () => {
    const last = new Date("2026-12-15T15:00:00Z");
    expect(nextEligibleAt({ frequency: "monthly", lastEntryAt: last, sponsorTz: NY })?.toISOString()).toBe(
      "2027-01-01T05:00:00.000Z",
    );
  });

  it("isDue respects end date", () => {
    const now = new Date("2026-06-01T12:00:00Z");
    expect(isDue({ frequency: "daily", lastEntryAt: null }, now)).toBe(true);
    expect(isDue({ frequency: "daily", lastEntryAt: null, endsAt: new Date("2026-05-01") }, now)).toBe(false);
    expect(isDue({ frequency: "daily", lastEntryAt: new Date("2026-06-01T11:00:00Z"), sponsorTz: NY }, now)).toBe(false);
  });
});

const RULES = `
OFFICIAL RULES — Summer Grill Giveaway. NO PURCHASE NECESSARY TO ENTER OR WIN.
Sponsor: Acme Outdoor Co., 123 Main St, Springfield, IL 62701.
The Sweepstakes begins at 12:00 a.m. ET on June 1, 2026 and ends at 11:59 p.m. ET on August 31, 2026.
ELIGIBILITY: Open to legal residents of the fifty (50) United States and D.C., who are 18 years of age or older.
Void in Florida, New York and Rhode Island, and where prohibited.
HOW TO ENTER: Limit one (1) entry per person per day.
ALTERNATE METHOD OF ENTRY: Hand-print your name, address, phone and email on a 3" x 5" card and mail it in an envelope to: Summer Grill Giveaway AMOE, PO Box 4567, Springfield, IL 62701.
Limit one entry per envelope. Entries must be postmarked by August 31, 2026 and received by September 7, 2026.
Mechanically reproduced entries will not be accepted. Entries submitted by third parties or entry services are void.
PRIZES: Grand Prize: Grill (ARV: $1,200). Total ARV of all prizes: $2,450.
`;

describe("parseRules", () => {
  const r = parseRules(RULES);
  it("extracts dates and frequency", () => {
    expect(r.startsAt?.toISOString().slice(0, 10)).toBe("2026-06-01");
    expect(r.endsAt?.toISOString().slice(0, 10)).toBe("2026-08-31");
    expect(r.frequency).toBe("daily");
  });
  it("extracts eligibility", () => {
    expect(r.minAge).toBe(18);
    expect(r.countries).toEqual(["US"]);
    expect(r.excludedStates).toEqual(["FL", "NY", "RI"]);
  });
  it("extracts sponsor and ARV", () => {
    expect(r.sponsor).toBe("Acme Outdoor Co.");
    expect(r.totalArv).toBe(2450);
  });
  it("extracts AMOE details", () => {
    expect(r.amoe.available).toBe(true);
    expect(r.amoe.address).toBe("Summer Grill Giveaway AMOE, PO Box 4567, Springfield, IL 62701");
    expect(r.amoe.deadlineType).toBe("received_by");
    expect(r.amoe.deadline?.toISOString().slice(0, 10)).toBe("2026-09-07");
    expect(r.amoe.handwrittenRequired).toBe(true);
    expect(r.amoe.cardSize).toBe("3x5");
    expect(r.amoe.limitPerEnvelope).toBe(1);
    expect(r.amoe.thirdPartyAllowed).toBe("no");
    expect(r.amoe.mechanicalReproductionAllowed).toBe("no");
  });
  it("does not exclude Virginia when only West Virginia is void", () => {
    expect(parseRules("Void in West Virginia and where prohibited.").excludedStates).toEqual(["WV"]);
  });
});

describe("classifyEmail", () => {
  it("detects a win notice and scam flags", () => {
    const real = classifyEmail({
      from: "prizes@acme.com",
      subject: "Potential Winner Notification - Summer Grill Giveaway",
      text: "Congratulations! You have been selected as a potential winner. Please complete and return the attached Affidavit of Eligibility and W-9 by October 1, 2026.",
    });
    expect(real.category).toBe("win_notice");
    expect(real.scamSignals).toEqual([]);
    expect(real.claimDeadlineText).toContain("October 1, 2026");

    const scam = classifyEmail({
      from: "claims@prize-center.biz",
      subject: "Congratulations you won $50,000!",
      text: "You have won! To release your prize pay the processing fee with gift cards. Act now.",
    });
    expect(scam.category).toBe("win_notice");
    expect(scam.scamSignals).toContain("asks for a fee");
  });

  it("does not flag newsletters about winners", () => {
    const c = classifyEmail({
      from: "news@sweepsblog.com",
      subject: "New sweepstakes this week",
      text: "See this week's winner list and 40 new sweepstakes. https://example.com/new. Unsubscribe here.",
    });
    expect(c.category).toBe("newsletter");
    expect(c.links).toEqual(["https://example.com/new"]);
  });

  it("detects confirmations", () => {
    expect(classifyEmail({ from: "a@b.c", subject: "Thanks for entering!", text: "Your entry has been received." }).category).toBe(
      "confirmation",
    );
  });
});

describe("AMOE", () => {
  it("computes mail-by dates", () => {
    const deadline = new Date("2026-09-07T12:00:00Z"); // Monday
    expect(mailByDate(deadline, "received_by").toISOString().slice(0, 10)).toBe("2026-08-31");
    expect(mailByDate(deadline, "postmarked_by").toISOString().slice(0, 10)).toBe("2026-09-04");
  });
  it("builds card lines", () => {
    const lines = amoeCardLines(
      { firstName: "Pat", lastName: "Lee", email: "pat@example.com", address1: "1 Elm St", city: "Austin", state: "TX", zip: "78701", birthDate: "1990-09-10" },
      { includeAge: true, asOf: new Date("2026-09-09T00:00:00Z") },
    );
    expect(lines).toEqual(["Pat Lee", "1 Elm St", "Austin, TX 78701", "pat@example.com", "Age: 35"]);
  });
});

describe("form matcher", () => {
  it("matches common fields", () => {
    expect(matchField({ autocomplete: "given-name" })).toBe("firstName");
    expect(matchField({ name: "entry[first_name]" })).toBe("firstName");
    expect(matchField({ id: "LastName" })).toBe("lastName");
    expect(matchField({ label: "Zip Code" })).toBe("zip");
    expect(matchField({ placeholder: "Street address" })).toBe("address1");
    expect(matchField({ name: "address2" })).toBe("address2");
    expect(matchField({ type: "email", name: "x" })).toBe("email");
    expect(matchField({ name: "dob_month" })).toBe("birthMonth");
    expect(matchField({ type: "hidden", name: "email" })).toBeNull();
  });
  it("chooses select options", () => {
    const states = [
      { value: "", text: "Select" },
      { value: "new-york", text: "New York" },
    ];
    expect(chooseOption(states, "NY")).toBe("new-york");
    expect(chooseOption([{ value: "3", text: "March" }], "03")).toBe("3");
    expect(chooseOption([{ value: "mar", text: "March" }], "03")).toBe("mar");
  });
  it("formats profile values", () => {
    const p = { firstName: "Pat", lastName: "Lee", email: "p@x.com", birthDate: "1990-09-10" };
    expect(profileValue(p, "fullName")).toBe("Pat Lee");
    expect(profileValue(p, "birthDate")).toBe("09/10/1990");
    expect(profileValue(p, "birthYear")).toBe("1990");
  });
});

describe("sources", () => {
  it("canonicalizes URLs", () => {
    expect(canonicalUrl("https://WWW.Acme.com/sweeps/?utm_source=x&b=2&a=1#top")).toBe("https://acme.com/sweeps?a=1&b=2");
  });
  it("parses RSS", () => {
    const xml = `<rss><channel><item><title><![CDATA[Win a Grill]]></title><link>https://acme.com/grill</link><pubDate>Mon, 01 Jun 2026 10:00:00 GMT</pubDate></item></channel></rss>`;
    const items = parseFeed(xml, "test");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "Win a Grill", url: "https://acme.com/grill" });
  });
});

describe("tax", () => {
  it("filters by year and exports CSV", () => {
    const wins = [
      { prize: "Grill, deluxe", sponsor: "Acme", arvCents: 120000, receivedAt: new Date("2026-05-01"), status: "received" },
      { prize: "Hat", sponsor: null, arvCents: 2000, receivedAt: new Date("2025-05-01"), status: "received" },
    ];
    const y = taxYearWins(wins, 2026);
    expect(y).toHaveLength(1);
    expect(winsToCsv(y)).toContain('"Grill, deluxe",Acme,1200.00,2026-05-01,yes');
  });
});
