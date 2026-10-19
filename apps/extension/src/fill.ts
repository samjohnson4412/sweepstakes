/**
 * Injected into the active tab on demand (activeTab + scripting). Fills visible form
 * fields from the selected entrant profile. It never submits the form or touches CAPTCHAs.
 */
import { chooseOption, matchField, profileValue, type EntrantProfileData, type FieldDescriptor } from "@sweeptrack/core";

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

function fill(profile: EntrantProfileData): { filled: number; fields: string[] } {
  const filledFields: string[] = [];
  const controls = document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input, select, textarea");
  for (const el of controls) {
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
    if (!field) continue;
    let value = profileValue(profile, field);
    if (!value) continue;
    if (el instanceof HTMLSelectElement) {
      value = chooseOption([...el.options].map((o) => ({ value: o.value, text: o.text })), value);
      if (value === null) continue;
    } else if (el instanceof HTMLInputElement && el.type === "date" && profile.birthDate && field === "birthDate") {
      value = profile.birthDate;
    }
    if (el.value === value) continue;
    setValue(el, value);
    el.style.outline = "2px solid #5b4bdb";
    filledFields.push(field);
  }
  return { filled: filledFields.length, fields: filledFields };
}

(window as unknown as { __sweeptrackFill: typeof fill }).__sweeptrackFill = fill;
