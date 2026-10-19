import type { EmailCategory } from "./types";

export interface EmailInput {
  from: string;
  subject: string;
  text: string;
}

export interface EmailClassification {
  category: EmailCategory;
  confidence: number;
  /** Signals that matched, for explainability in the UI. */
  signals: string[];
  /** Red flags typical of prize scams; shown as a warning even on real-looking win notices. */
  scamSignals: string[];
  /** Absolute http(s) links found in the message (deduped). */
  links: string[];
  /** Claim/affidavit deadline if one is stated. */
  claimDeadlineText: string | null;
}

const WIN_PATTERNS: [RegExp, string, number][] = [
  [/\b(?:potential|confirmed|selected|declared)? ?winner\b/i, "winner", 2],
  [/\bcongratulations\b/i, "congratulations", 1],
  [/\byou(?:'ve| have)? (?:won|been selected)\b/i, "you won", 3],
  [/\baffidavit\b/i, "affidavit", 3],
  [/\b(?:w-?9|1099)\b/i, "tax form", 2],
  [/\brelease of liability|publicity release\b/i, "release", 2],
  [/\bclaim (?:your )?prize\b/i, "claim prize", 2],
  [/\bprize notification|winner notification\b/i, "prize notification", 3],
];

const SCAM_PATTERNS: [RegExp, string][] = [
  [/\b(?:processing|handling|release|shipping|delivery|customs) fee\b/i, "asks for a fee"],
  [/\bgift cards?\b[^.]{0,60}\b(?:pay|purchase|buy)\b|\b(?:pay|purchase|buy)\b[^.]{0,60}\bgift cards?\b/i, "gift-card payment"],
  [/\b(?:wire transfer|western union|moneygram|zelle|cash ?app|crypto|bitcoin)\b/i, "unusual payment method"],
  [/\b(?:bank account|routing number|credit card) (?:number|details|information)\b/i, "asks for bank/card details"],
  [/\bsocial security number\b[^.]{0,80}\b(?:reply|email|text)\b/i, "SSN by email/text"],
  [/\bact (?:now|immediately)|within 24 hours or\b/i, "pressure tactics"],
];

const CONFIRMATION = /\b(?:thanks? (?:you )?for (?:entering|your entry)|entry (?:has been )?(?:received|confirmed)|confirm your (?:entry|email)|you(?:'re| are) entered)\b/i;
const NEWSLETTER = /\b(?:unsubscribe|view (?:this email )?in (?:your )?browser|newsletter|new sweepstakes|sweeps (?:of the|this) (?:day|week))\b/i;
const PROMO = /\b(?:% off|sale|coupon|promo code|limited time offer|shop now)\b/i;

export function extractLinks(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) {
    out.add(m[0].replace(/[.,;:!?]+$/, ""));
  }
  return [...out];
}

export function classifyEmail(input: EmailInput): EmailClassification {
  const haystack = `${input.subject}\n${input.text}`;
  const signals: string[] = [];
  let winScore = 0;
  for (const [re, label, weight] of WIN_PATTERNS) {
    if (re.test(haystack)) {
      signals.push(label);
      winScore += weight;
    }
  }
  // A subject line mentioning winning is a much stronger signal than body text.
  if (/\b(?:winner|won|prize|congratulations)\b/i.test(input.subject)) winScore += 1;
  // Newsletters that list "winners" pages shouldn't trip the win detector on their own.
  const looksNewsletter = NEWSLETTER.test(haystack);
  if (looksNewsletter && !signals.some((s) => ["affidavit", "you won", "prize notification"].includes(s))) {
    winScore -= 2;
  }

  const scamSignals = SCAM_PATTERNS.filter(([re]) => re.test(haystack)).map(([, label]) => label);
  const deadline = haystack.match(/(?:return|submit|complete|respond)[^.]{0,80}?(?:by|within|no later than)\s+([^.\n]{3,60})/i);

  let category: EmailCategory;
  let confidence: number;
  if (winScore >= 4) {
    category = "win_notice";
    confidence = Math.min(0.95, 0.5 + winScore * 0.07);
  } else if (CONFIRMATION.test(haystack)) {
    category = "confirmation";
    confidence = 0.7;
    signals.push("entry confirmation");
  } else if (looksNewsletter) {
    category = "newsletter";
    confidence = 0.6;
    signals.push("newsletter");
  } else if (PROMO.test(haystack)) {
    category = "promo";
    confidence = 0.5;
  } else {
    category = "other";
    confidence = 0.3;
  }

  return {
    category,
    confidence,
    signals,
    scamSignals,
    links: extractLinks(input.text),
    claimDeadlineText: category === "win_notice" ? deadline?.[1]?.trim() ?? null : null,
  };
}
