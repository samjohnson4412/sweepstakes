/**
 * Injected into the active tab on demand (activeTab + scripting). Fills visible form
 * fields from the selected entrant profile. It never submits the form or touches CAPTCHAs.
 */
import {
  chooseOption,
  matchField,
  PROFILE_FIELDS,
  profileValue,
  type EntrantProfileData,
  type FieldDescriptor,
  type ProfileField,
} from "@sweeptrack/core";

export interface FieldMapping {
  selector: string;
  field: ProfileField;
}

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function labelFor(el: HTMLElement): string {
  const parts: string[] = [];
  if (el.id) {
    const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (l) parts.push(l.textContent ?? "");
  }
  const wrapping = el.closest("label");
  if (wrapping) parts.push(wrapping.textContent ?? "");
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) for (const id of labelledBy.split(/\s+/)) parts.push(document.getElementById(id)?.textContent ?? "");
  return parts.join(" ").trim().slice(0, 120);
}

function isVisible(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  return r.width > 0 && r.height > 0 && style.visibility !== "hidden" && style.display !== "none";
}

/** Set a value in a way React/Vue-controlled inputs notice. */
function setValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto = Object.getPrototypeOf(el) as object;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Write a profile value into a control, handling <select> option matching. Returns true if it changed. */
function applyValue(el: Control, field: ProfileField, profile: EntrantProfileData): boolean {
  let value = profileValue(profile, field);
  if (!value) return false;
  if (el instanceof HTMLSelectElement) {
    value = chooseOption([...el.options].map((o) => ({ value: o.value, text: o.text })), value);
    if (value === null) return false;
  } else if (el instanceof HTMLInputElement && el.type === "date" && field === "birthDate" && profile.birthDate) {
    value = profile.birthDate;
  }
  if (el.value === value) return false;
  setValue(el, value);
  el.style.outline = "2px solid #5b4bdb";
  return true;
}

function fill(profile: EntrantProfileData, mappings: FieldMapping[] = []): { filled: number; fields: string[] } {
  const filledFields: string[] = [];
  const handled = new Set<Element>();
  // Learned per-site mappings win over heuristics.
  for (const m of mappings) {
    let el: Element | null = null;
    try {
      el = document.querySelector(m.selector);
    } catch {
      continue; // invalid selector
    }
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) continue;
    handled.add(el);
    if (applyValue(el, m.field, profile)) filledFields.push(m.field);
  }
  const controls = document.querySelectorAll<Control>("input, select, textarea");
  for (const el of controls) {
    if (handled.has(el)) continue;
    if (el.disabled || (el as HTMLInputElement).readOnly || !isVisible(el)) continue;
    const descriptor: FieldDescriptor = {
      type: el instanceof HTMLInputElement ? el.type : el.tagName.toLowerCase(),
      name: el.name,
      id: el.id,
      autocomplete: el.getAttribute("autocomplete") ?? undefined,
      label: labelFor(el),
      placeholder: el.getAttribute("placeholder") ?? undefined,
      ariaLabel: el.getAttribute("aria-label") ?? undefined,
    };
    const field = matchField(descriptor);
    if (field && applyValue(el, field, profile)) filledFields.push(field);
  }
  return { filled: filledFields.length, fields: filledFields };
}

function selectorFor(el: Control): string | null {
  if (el.id && !/\d{4,}/.test(el.id)) return `#${CSS.escape(el.id)}`; // skip auto-generated ids
  if (el.name) return `${el.tagName.toLowerCase()}[name="${CSS.escape(el.name)}"]`;
  return null;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9@.]/g, "");

/**
 * "Remember this form": after the user has filled/fixed the form, map each field whose
 * value equals a profile value to a stable selector, so next time fills are exact.
 */
function learn(profile: EntrantProfileData): FieldMapping[] {
  const out: FieldMapping[] = [];
  for (const el of document.querySelectorAll<Control>("input, select, textarea")) {
    if (!el.value || !isVisible(el) || (el instanceof HTMLInputElement && ["hidden", "password", "checkbox", "radio", "submit"].includes(el.type))) continue;
    const selector = selectorFor(el);
    if (!selector) continue;
    const shown = el instanceof HTMLSelectElement ? [el.value, el.selectedOptions[0]?.text ?? ""] : [el.value];
    const field = PROFILE_FIELDS.find((f) => {
      const v = profileValue(profile, f);
      if (!v) return false;
      if (el instanceof HTMLSelectElement) return chooseOption([{ value: el.value, text: el.selectedOptions[0]?.text ?? "" }], v) !== null;
      return shown.some((s) => norm(s) === norm(v));
    });
    if (field) out.push({ selector, field });
  }
  return out;
}

Object.assign(window as unknown as Record<string, unknown>, { __sweeptrackFill: fill, __sweeptrackLearn: learn });
