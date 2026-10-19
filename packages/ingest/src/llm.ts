import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";
import { FREQUENCIES, type ParsedRules } from "@sweeptrack/core";

/**
 * Claude-assisted extraction for official-rules pages the regex parser can't read
 * confidently. Enabled when ANTHROPIC_API_KEY is set (and RULES_LLM_DISABLED is not).
 * Model is configurable via RULES_LLM_MODEL; claude-haiku-5-5 is far cheaper if
 * quality holds on your pages.
 */
const MODEL = process.env.RULES_LLM_MODEL ?? "claude-opus-5-5";
/** Rules pages are rarely this long; past it we skip rather than truncate the legal text. */
const MAX_CHARS = 400_000;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().describe("YYYY-MM-DD, or null if not stated");

const RulesSchema = z.object({
  sponsor: z.string().nullable(),
  start_date: date,
  end_date: date,
  online_entry_frequency: z.enum(FREQUENCIES).nullable().describe(
    "once = one entry for the whole promotion; daily = once per calendar day; daily_24h = once per rolling 24 hours",
  ),
  min_age: z.number().int().nullable(),
  open_to_us_residents: z.boolean().nullable(),
  excluded_us_states: z.array(z.string()).describe("Two-letter codes of US states where the promotion is void"),
  total_arv_usd: z.number().nullable(),
  prize_summary: z.string().nullable().describe("One short sentence describing the prizes"),
  amoe: z.object({
    available: z.boolean(),
    mailing_address: z.string().nullable().describe("Full mailing address on one line"),
    deadline: date,
    deadline_type: z.enum(["postmarked_by", "received_by", "unknown"]),
    handwritten_required: z.boolean(),
    card_size: z.string().nullable().describe('e.g. "3x5"'),
    sase_required: z.boolean(),
    limit_per_envelope: z.number().int().nullable(),
    third_party_entries_allowed: z.enum(["yes", "no", "unknown"]).describe(
      'no if entries by third parties, entry services, or on behalf of others are void/prohibited; yes only if explicitly permitted',
    ),
    mechanical_reproduction_allowed: z.enum(["yes", "no", "unknown"]),
  }),
});
export type LlmRules = z.infer<typeof RulesSchema>;

export function llmEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY) && !process.env.RULES_LLM_DISABLED;
}

/** Whether the regex result is shaky enough to be worth an LLM call. */
export function needsLlm(parsed: ParsedRules | null): boolean {
  if (!parsed) return true;
  if (!parsed.endsAt || !parsed.frequency) return true;
  return Object.values(parsed.confidence).some((c) => c !== undefined && c < 0.6);
}

let client: Anthropic | null = null;

export async function extractRulesWithLlm(text: string): Promise<LlmRules | null> {
  if (!llmEnabled() || text.length > MAX_CHARS) return null;
  client ??= new Anthropic();
  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: zodOutputFormat(RulesSchema) },
    system:
      "You extract facts from sweepstakes and contest official rules for a tracking app. Use only what the text states; use null or \"unknown\" when it doesn't say. Dates are calendar dates as written in the rules.",
    messages: [{ role: "user", content: `<rules>\n${text}\n</rules>` }],
  });
  if (response.stop_reason === "refusal") return null;
  return response.parsed_output ?? null;
}

const toDate = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`) : null);

/** Fill gaps in the regex result with LLM output; regex values with good confidence win. */
export function mergeLlmRules(parsed: ParsedRules | null, llm: LlmRules): ParsedRules {
  const base: ParsedRules = parsed ?? {
    sponsor: null,
    startsAt: null,
    endsAt: null,
    frequency: null,
    minAge: null,
    countries: [],
    excludedStates: [],
    totalArv: null,
    amoe: {
      available: false,
      address: null,
      deadlineType: "unknown",
      deadline: null,
      handwrittenRequired: false,
      cardSize: null,
      sasRequired: false,
      limitPerEnvelope: null,
      thirdPartyAllowed: "unknown",
      mechanicalReproductionAllowed: "unknown",
    },
    confidence: {},
  };
  const weak = (k: keyof ParsedRules["confidence"]) => (base.confidence[k] ?? 0) < 0.6;
  const a = llm.amoe;
  return {
    sponsor: base.sponsor ?? llm.sponsor,
    startsAt: weak("dates") ? toDate(llm.start_date) ?? base.startsAt : base.startsAt,
    endsAt: weak("dates") ? toDate(llm.end_date) ?? base.endsAt : base.endsAt,
    frequency: weak("frequency") ? llm.online_entry_frequency ?? base.frequency : base.frequency,
    minAge: base.minAge ?? llm.min_age,
    countries: base.countries.length ? base.countries : llm.open_to_us_residents ? ["US"] : [],
    excludedStates: base.excludedStates.length ? base.excludedStates : llm.excluded_us_states.map((s) => s.toUpperCase()).sort(),
    totalArv: weak("arv") ? llm.total_arv_usd ?? base.totalArv : base.totalArv,
    amoe: weak("amoe")
      ? {
          available: a.available || base.amoe.available,
          address: a.mailing_address ?? base.amoe.address,
          deadlineType: a.deadline_type !== "unknown" ? a.deadline_type : base.amoe.deadlineType,
          deadline: toDate(a.deadline) ?? base.amoe.deadline,
          handwrittenRequired: a.handwritten_required || base.amoe.handwrittenRequired,
          cardSize: a.card_size ?? base.amoe.cardSize,
          sasRequired: a.sase_required || base.amoe.sasRequired,
          limitPerEnvelope: a.limit_per_envelope ?? base.amoe.limitPerEnvelope,
          // A "no" from either source wins: wrongly offering the mail service voids entries.
          thirdPartyAllowed: base.amoe.thirdPartyAllowed === "no" ? "no" : a.third_party_entries_allowed,
          mechanicalReproductionAllowed:
            base.amoe.mechanicalReproductionAllowed === "no" ? "no" : a.mechanical_reproduction_allowed,
        }
      : base.amoe,
    confidence: { dates: 0.8, frequency: 0.8, amoe: 0.8, eligibility: 0.8, arv: 0.8, ...strong(base.confidence) },
  };
}

function strong(c: ParsedRules["confidence"]): ParsedRules["confidence"] {
  return Object.fromEntries(Object.entries(c).filter(([, v]) => (v ?? 0) >= 0.8));
}
