import { describe, expect, it } from "vitest";
import { parseRules } from "@sweeptrack/core";
import { mergeLlmRules, needsLlm, type LlmRules } from "./llm";

const llm: LlmRules = {
  sponsor: "Brand Co",
  start_date: "2026-06-01",
  end_date: "2026-12-15",
  online_entry_frequency: "daily",
  min_age: 18,
  open_to_us_residents: true,
  excluded_us_states: ["fl", "ny"],
  total_arv_usd: 900,
  prize_summary: "A grill",
  amoe: {
    available: true,
    mailing_address: "PO Box 1, Austin, TX 78701",
    deadline: "2026-12-20",
    deadline_type: "received_by",
    handwritten_required: true,
    card_size: "3x5",
    sase_required: false,
    limit_per_envelope: 1,
    third_party_entries_allowed: "yes",
    mechanical_reproduction_allowed: "unknown",
  },
};

describe("mergeLlmRules", () => {
  it("fills gaps the regex parser left", () => {
    const weak = parseRules("Win a grill! Enter now.");
    expect(needsLlm(weak)).toBe(true);
    const merged = mergeLlmRules(weak, llm);
    expect(merged.endsAt?.toISOString().slice(0, 10)).toBe("2026-12-15");
    expect(merged.frequency).toBe("daily");
    expect(merged.countries).toEqual(["US"]);
    expect(merged.excludedStates).toEqual(["FL", "NY"]);
    expect(merged.amoe.address).toBe("PO Box 1, Austin, TX 78701");
  });

  it("never lets the LLM flip a regex 'no' on third-party entries", () => {
    const parsed = parseRules("Alternate method of entry: mail to Box 1, Austin, TX 78701. Entries submitted by third parties are void.");
    expect(parsed.amoe.thirdPartyAllowed).toBe("no");
    expect(mergeLlmRules(parsed, llm).amoe.thirdPartyAllowed).toBe("no");
  });
});
