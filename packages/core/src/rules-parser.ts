import type { AmoeDeadlineType, Frequency, TriState } from "./types";

/**
 * Deterministic extraction of key facts from official-rules text.
 * Results carry per-field confidence so the UI can ask users to confirm, and an
 * LLM pass can later fill gaps for messy pages.
 */
export interface ParsedRules {
  sponsor: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  frequency: Frequency | null;
  minAge: number | null;
  countries: string[];
  excludedStates: string[];
  totalArv: number | null;
  amoe: {
    available: boolean;
    address: string | null;
    deadlineType: AmoeDeadlineType;
    deadline: Date | null;
    handwrittenRequired: boolean;
    cardSize: string | null;
    sasRequired: boolean;
    limitPerEnvelope: number | null;
    thirdPartyAllowed: TriState;
    mechanicalReproductionAllowed: TriState;
  };
  confidence: Partial<Record<"dates" | "frequency" | "amoe" | "eligibility" | "arv", number>>;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

export const US_STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
  connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID",
  illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR",
  pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
  tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA",
  "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "puerto rico": "PR",
};

const MONTH_NAME = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const DATE_RE = new RegExp(
  `${MONTH_NAME}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})|(\\d{1,2})/(\\d{1,2})/(\\d{2,4})`,
  "gi",
);

interface FoundDate {
  date: Date;
  index: number;
}

function findDates(text: string): FoundDate[] {
  const out: FoundDate[] = [];
  for (const m of text.matchAll(DATE_RE)) {
    let y: number, mo: number, d: number;
    if (m[1]) {
      mo = MONTHS[m[1].toLowerCase().slice(0, 3)] ?? 0;
      d = Number(m[2]);
      y = Number(m[3]);
    } else {
      mo = Number(m[4]);
      d = Number(m[5]);
      y = Number(m[6]);
      if (y < 100) y += 2000;
    }
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    // Store as noon UTC on that calendar day; callers treat it as a date, and the
    // end-of-day time is refined from the sponsor timezone when known.
    out.push({ date: new Date(Date.UTC(y, mo - 1, d, 12)), index: m.index ?? 0 });
  }
  return out;
}

/** Date closest after a keyword match, within a window. */
function dateNear(text: string, keyword: RegExp, dates: FoundDate[], window = 220): Date | null {
  for (const k of text.matchAll(new RegExp(keyword.source, keyword.flags.includes("g") ? keyword.flags : keyword.flags + "g"))) {
    const at = k.index ?? 0;
    const hit = dates.find((d) => d.index >= at && d.index - at <= window);
    if (hit) return hit.date;
  }
  return null;
}

function parseMoney(s: string): number {
  return Number(s.replace(/[$,\s]/g, ""));
}

/** Strip a trailing street address ("Acme Co. 12 Main St…", "…, located at…", "…, PO Box 5"). */
function cleanSponsor(raw: string | undefined): string | null {
  if (!raw) return null;
  const cut = raw
    .split(/,?\s+(?:located|with (?:its )?(?:offices|headquarters)|whose address|headquartered)\b/i)[0]!
    .split(/,?\s*P\.?\s?O\.?\s+Box\b/i)[0]!
    .split(/,?\s+\d{1,6}\s+(?:[A-Za-z0-9.]+\s+){0,4}(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Way|Hill|Pkwy|Parkway|Ct|Court|Hwy|Highway|Suite|Place|Pl)\b/i)[0]!;
  const s = cut.trim().replace(/,$/, "");
  return s.length >= 2 ? s : null;
}

export function parseRules(rawText: string): ParsedRules {
  const text = rawText.replace(/\s+/g, " ");
  const lower = text.toLowerCase();
  const dates = findDates(text);
  const confidence: ParsedRules["confidence"] = {};

  // --- Sponsor
  const sponsorMatch = text.match(/\b[Ss]ponsor(?:ed by)?(?:\s+is)?\s*[:\-]?\s+([A-Z][\w&.,' -]{2,80}?)(?:\s*\(|,\s*\d|\.\s|;)/);
  // Labelled "Sponsor: X" on its own line (listing pages) is the most reliable form.
  const labelled = rawText.match(/^\s*sponsor(?:ed by)?\s*:\s*([^\n]{2,120}?)\s*$/im)?.[1]?.split(/,\s*\d|\s\(/)[0];
  const sponsor = cleanSponsor(labelled && !/[.;]\s/.test(labelled) ? labelled : sponsorMatch?.[1]);

  // --- Dates
  let startsAt = dateNear(text, /\b(begins?|starts?|commences?)\b/i, dates);
  let endsAt = dateNear(text, /\b(ends?|ending|through|until|closes?|expires?)\b/i, dates);
  const periodMatch = text.match(/promotion period[^.]{0,200}/i);
  if (periodMatch) {
    const inPeriod = findDates(periodMatch[0]);
    if (inPeriod.length >= 2) {
      startsAt ??= inPeriod[0]!.date;
      endsAt = inPeriod[inPeriod.length - 1]!.date;
    }
  }
  if (startsAt && endsAt && endsAt < startsAt) [startsAt, endsAt] = [endsAt, startsAt];
  if (startsAt || endsAt) confidence.dates = startsAt && endsAt ? 0.8 : 0.5;

  // --- Frequency (online entry limit)
  let frequency: Frequency | null = null;
  const limit = lower.match(/(?:limit|maximum)[^.]{0,120}|one \(1\) entry[^.]{0,120}|one entry[^.]{0,120}|may enter[^.]{0,120}/g)?.join(" ") ?? "";
  const entryLimitLabel = lower.match(/entry (?:limit|frequency)\s*:\s*([^.]{0,60})/)?.[1] ?? "";
  if (/single|one[- ]time|one entry/.test(entryLimitLabel)) frequency = "once";
  else if (/daily|per day|each day/.test(entryLimitLabel)) frequency = "daily";
  else if (/weekly|per week/.test(entryLimitLabel)) frequency = "weekly";
  else if (/monthly|per month/.test(entryLimitLabel)) frequency = "monthly";
  else if (/24[- ]hour/.test(limit)) frequency = "daily_24h";
  else if (/per (?:calendar )?day|each day|daily/.test(limit)) frequency = "daily";
  else if (/per (?:calendar )?week|each week|weekly/.test(limit)) frequency = "weekly";
  else if (/per (?:calendar )?month|each month|monthly/.test(limit)) frequency = "monthly";
  else if (/per (?:person|email|household)/.test(limit) || /\b(?:only|maximum of) one\b/.test(limit)) frequency = "once";
  else if (/enter daily|daily entr/.test(lower)) frequency = "daily";
  if (frequency) confidence.frequency = limit ? 0.75 : 0.4;

  // --- Eligibility
  const ageMatch = lower.match(/(\d{2})\s*(?:years of age|years old|\+)\s*(?:or older|and older)?/) ??
    lower.match(/age of (\d{2})/);
  let minAge = ageMatch ? Number(ageMatch[1]) : null;
  if (minAge !== null && (minAge < 13 || minAge > 25)) minAge = null;
  if (minAge === null && /age of majority/.test(lower)) minAge = 18;

  const countries: string[] = [];
  if (/united states|\bu\.s\.|\bus residents|50 states|fifty \(50\)/.test(lower)) countries.push("US");
  if (/\bcanada\b|canadian/.test(lower) && !/excluding canada|canada is excluded|not open to residents of canada/.test(lower)) countries.push("CA");

  const excludedStates = new Set<string>();
  const voidClauses = lower.match(/(?:void in|excluding|except(?: for)?|not open to residents of|residents of)[^.]{0,160}/g) ?? [];
  for (const clause of voidClauses) {
    const isExclusion = !clause.startsWith("residents of") || /(?:not eligible|are excluded|ineligible)/.test(clause);
    if (!isExclusion) continue;
    for (const [name, code] of Object.entries(US_STATES)) {
      const re = name === "virginia" ? /(?<!west )\bvirginia\b/ : new RegExp(`\\b${name}\\b`);
      if (re.test(clause)) excludedStates.add(code);
    }
  }
  if (minAge !== null || countries.length) confidence.eligibility = 0.6;

  // --- ARV
  let totalArv: number | null = null;
  const totalMatch =
    text.match(/total (?:approximate retail value|arv)[^$]{0,60}\$\s?([\d,]+(?:\.\d{2})?)/i) ??
    text.match(/total (?:approximate retail value|arv)[^.\d]{0,40}([\d,]+(?:\.\d{2})?)\s*(?:usd|dollars)/i);
  if (totalMatch) {
    totalArv = parseMoney(totalMatch[1]!);
    confidence.arv = 0.85;
  } else {
    const arvs = [
      ...text.matchAll(/(?:approximate retail value|\bARV\b)[^$]{0,60}\$\s?([\d,]+(?:\.\d{2})?)/gi),
      ...text.matchAll(/(?:approximate retail value|\bARV\b)[^.\d$]{0,40}([\d,]+(?:\.\d{2})?)\s*(?:usd|dollars)/gi),
    ].map((m) => parseMoney(m[1]!));
    if (arvs.length) {
      totalArv = Math.max(...arvs);
      confidence.arv = 0.5;
    }
  }

  // --- AMOE
  const amoeAvailable = /alternat(?:e|ive) (?:method|means) of entry|\bamoe\b|mail-in|enter by mail|to enter (?:without|by) mail|hand[- ]?print/.test(lower);
  let address: string | null = null;
  const addrMatch = text.match(/(?:mail|send)(?: it| your entry| them)?(?: in an envelope| with[^,]{0,40})?\s+to:?\s+(.{10,200}?\b[A-Z]{2}\s+\d{5}(?:-\d{4})?)/);
  if (addrMatch) address = addrMatch[1]!.replace(/^["“]|["”]$/g, "").trim();

  let deadlineType: AmoeDeadlineType = "unknown";
  let amoeDeadline: Date | null = null;
  if (/postmarked (?:by|no later than|on or before)/.test(lower)) {
    deadlineType = "postmarked_by";
    amoeDeadline = dateNear(text, /postmarked (?:by|no later than|on or before)/i, dates);
  }
  if (/received (?:by|no later than|on or before)/.test(lower)) {
    // When both appear (common: "postmarked by X and received by Y"), received-by is the binding one.
    deadlineType = "received_by";
    amoeDeadline = dateNear(text, /received (?:by|no later than|on or before)/i, dates) ?? amoeDeadline;
  }

  const cardMatch = text.match(/(\d)["”]?\s*(?:x|×|by)\s*(\d)["”]?\s*(?:inch(?:es)?\s*)?(?:piece of paper|card|index card|paper)/i);
  const envMatch = lower.match(/limit(?: of)? (?:one|1|\w+ \(\d+\)) (?:entry|request) per (?:outer )?envelope/);

  const thirdPartyAllowed: TriState =
    /(?:third[- ]part(?:y|ies)|entry service|commercial(?:ly)? entr|on behalf of (?:another|others))[^.]{0,120}(?:void|not (?:be )?accepted|prohibited|disqualif|not permitted)|(?:void|not (?:be )?accepted|prohibited|not permitted)[^.]{0,120}(?:third[- ]part(?:y|ies)|entry service)/.test(lower)
      ? "no"
      : "unknown";
  const mechanicalReproductionAllowed: TriState =
    /mechanical(?:ly)? reproduc[^.]{0,80}(?:not|void|prohibited)|(?:not|void)[^.]{0,80}mechanical(?:ly)? reproduc/.test(lower)
      ? "no"
      : "unknown";

  if (amoeAvailable) confidence.amoe = address ? 0.7 : 0.4;

  return {
    sponsor,
    startsAt,
    endsAt,
    frequency,
    minAge,
    countries,
    excludedStates: [...excludedStates].sort(),
    totalArv,
    amoe: {
      available: amoeAvailable,
      address,
      deadlineType,
      deadline: amoeDeadline,
      handwrittenRequired: /hand[- ]?(?:print|written|write)/.test(lower),
      cardSize: cardMatch ? `${cardMatch[1]}x${cardMatch[2]}` : null,
      sasRequired: /self[- ]addressed,? stamped|\bsase\b/.test(lower),
      limitPerEnvelope: envMatch ? 1 : null,
      thirdPartyAllowed,
      mechanicalReproductionAllowed,
    },
    confidence,
  };
}

/** Rough HTML → text conversion for fetched rules pages (server-side, no DOM). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

export function extractTitle(html: string): string | null {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  const t = og?.[1] ?? html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
  return t ? htmlToText(t).slice(0, 200) : null;
}

/** Find a link to official rules on a sweepstakes landing page. */
export function findRulesLink(html: string, baseUrl: string): string | null {
  for (const m of html.matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = htmlToText(m[2] ?? "").toLowerCase();
    const href = m[1]!;
    if (/official rules|rules|terms/.test(label) || /rules/i.test(href)) {
      try {
        return new URL(href, baseUrl).toString();
      } catch {
        continue;
      }
    }
  }
  return null;
}
