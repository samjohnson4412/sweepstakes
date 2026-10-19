export function money(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: cents % 100 ? 2 : 0 });
}

export function fmtDate(d: Date | string | null | undefined, tz = "America/New_York"): string {
  if (!d) return "—";
  // Plain YYYY-MM-DD values are calendar dates; don't shift them across timezones.
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
    return new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  }
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: tz });
}

export function fmtDateTime(d: Date | null | undefined, tz = "America/New_York"): string {
  if (!d) return "—";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz });
}

export function relDays(d: Date | string | null | undefined, now = new Date()): string {
  if (!d) return "";
  const target = typeof d === "string" ? new Date(`${d}T12:00:00Z`) : d;
  const days = Math.ceil((target.getTime() - now.getTime()) / 86_400_000);
  if (days < 0) return `${-days}d ago`;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days}d`;
}

export const FREQUENCY_LABEL: Record<string, string> = {
  once: "One-time",
  daily: "Daily",
  daily_24h: "Every 24h",
  weekly: "Weekly",
  monthly: "Monthly",
  unlimited: "Unlimited",
  per_purchase: "Per purchase",
};
