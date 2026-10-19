import type { EntrantProfileData, ProfileField } from "./types";
import { US_STATES } from "./rules-parser";

/** What the extension can observe about a form control (no DOM types here, so it's testable). */
export interface FieldDescriptor {
  type?: string;
  name?: string;
  id?: string;
  autocomplete?: string;
  label?: string;
  placeholder?: string;
  ariaLabel?: string;
}

const AUTOCOMPLETE_MAP: Record<string, ProfileField> = {
  "given-name": "firstName",
  "family-name": "lastName",
  name: "fullName",
  email: "email",
  tel: "phone",
  "tel-national": "phone",
  "address-line1": "address1",
  "street-address": "address1",
  "address-line2": "address2",
  "address-level2": "city",
  "address-level1": "state",
  "postal-code": "zip",
  country: "country",
  "country-name": "country",
  bday: "birthDate",
  "bday-day": "birthDay",
  "bday-month": "birthMonth",
  "bday-year": "birthYear",
};

// Order matters: more specific patterns first.
const HEURISTICS: [RegExp, ProfileField][] = [
  [/e-?mail/, "email"],
  [/first.?name|fname|given/, "firstName"],
  [/last.?name|lname|surname|family/, "lastName"],
  [/full.?name|^name$|your.?name/, "fullName"],
  [/phone|mobile|cell|tel/, "phone"],
  [/address.?(?:2|line.?2)|apt|suite|unit/, "address2"],
  [/address|street|addr/, "address1"],
  [/city|town/, "city"],
  [/state|province|region/, "state"],
  [/zip|postal|post.?code/, "zip"],
  [/country/, "country"],
  [/birth.?month|dob.?m|bday.?m/, "birthMonth"],
  [/birth.?day|dob.?d|bday.?d/, "birthDay"],
  [/birth.?year|dob.?y|bday.?y/, "birthYear"],
  [/birth|dob|bday/, "birthDate"],
];

export function matchField(f: FieldDescriptor): ProfileField | null {
  if (f.type && ["hidden", "submit", "button", "password", "checkbox", "radio", "file"].includes(f.type)) return null;
  const ac = f.autocomplete?.toLowerCase().split(/\s+/).pop();
  if (ac && AUTOCOMPLETE_MAP[ac]) return AUTOCOMPLETE_MAP[ac]!;
  if (f.type === "email") return "email";
  if (f.type === "tel") return "phone";

  const hay = [f.name, f.id, f.label, f.placeholder, f.ariaLabel]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/[_\-\[\]]/g, " ");
  if (!hay) return null;
  for (const token of [hay, hay.replace(/\s+/g, "")]) {
    for (const [re, field] of HEURISTICS) if (re.test(token)) return field;
  }
  return null;
}

/** Value to type into a field for a given profile. */
export function profileValue(profile: EntrantProfileData, field: ProfileField): string | null {
  const [by, bm, bd] = profile.birthDate?.split("-") ?? [];
  switch (field) {
    case "fullName":
      return `${profile.firstName} ${profile.lastName}`;
    case "birthYear":
      return by ?? null;
    case "birthMonth":
      return bm ?? null;
    case "birthDay":
      return bd ?? null;
    case "birthDate":
      return profile.birthDate ? `${bm}/${bd}/${by}` : null;
    default:
      return (profile[field as keyof EntrantProfileData] as string | null | undefined) ?? null;
  }
}

/**
 * Pick the best <select> option for a value (e.g. "NY" vs "New York", "03" vs "3" vs "March").
 * Returns the option value to set, or null.
 */
export function chooseOption(options: { value: string; text: string }[], wanted: string): string | null {
  const norm = (s: string) => s.trim().toLowerCase();
  const w = norm(wanted);
  const stateName = Object.entries(US_STATES).find(([, code]) => code.toLowerCase() === w)?.[0];
  const asNumber = /^\d+$/.test(w) ? String(Number(w)) : null;
  const monthName = asNumber
    ? new Date(Date.UTC(2000, Number(asNumber) - 1, 1)).toLocaleString("en-US", { month: "long", timeZone: "UTC" }).toLowerCase()
    : null;

  for (const o of options) {
    const v = norm(o.value);
    const t = norm(o.text);
    if (v === w || t === w) return o.value;
    if (stateName && (t === stateName || v === stateName)) return o.value;
    if (asNumber && (String(Number(v)) === asNumber || String(Number(t)) === asNumber)) return o.value;
    if (monthName && (t === monthName || t === monthName.slice(0, 3))) return o.value;
  }
  return null;
}
