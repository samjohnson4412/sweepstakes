import {
  canonicalUrl,
  extractTitle,
  findRulesLink,
  htmlToText,
  parseRules,
  type Frequency,
  type ParsedRules,
} from "@sweeptrack/core";
import { and, db, eq, sweepstakes, sweepstakesSources } from "@sweeptrack/db";
import { fetchPublicPage } from "./fetch";
import { extractRulesWithLlm, llmEnabled, mergeLlmRules, needsLlm } from "./llm";

export interface PageAnalysis {
  finalUrl: string;
  title: string | null;
  rulesUrl: string | null;
  text: string;
  parsed: ParsedRules;
  usedLlm: boolean;
  warning?: string;
}

/** Fetch a sweepstakes page (+ its official rules link) and extract the facts. */
export async function analyzePage(url: string, opts: { polite?: boolean; extraText?: string } = {}): Promise<PageAnalysis> {
  const landing = await fetchPublicPage(url, { polite: opts.polite });
  const title = extractTitle(landing.html);
  const rulesUrl = findRulesLink(landing.html, landing.finalUrl);
  let text = [opts.extraText, htmlToText(landing.html)].filter(Boolean).join("\n");
  let warning: string | undefined;
  if (rulesUrl && rulesUrl !== landing.finalUrl) {
    try {
      text += "\n" + htmlToText((await fetchPublicPage(rulesUrl, { polite: opts.polite })).html);
    } catch (e) {
      warning = `Couldn't fetch rules page: ${(e as Error).message}`;
    }
  }
  const result = await parseWithFallback(text);
  return { finalUrl: landing.finalUrl, title, rulesUrl, text, ...result, warning };
}

/** Regex parse, then a Claude pass when key facts are missing or low-confidence. */
export async function parseWithFallback(text: string): Promise<{ parsed: ParsedRules; usedLlm: boolean }> {
  const parsed = parseRules(text);
  if (!llmEnabled() || !needsLlm(parsed)) return { parsed, usedLlm: false };
  try {
    const llm = await extractRulesWithLlm(text);
    return llm ? { parsed: mergeLlmRules(parsed, llm), usedLlm: true } : { parsed, usedLlm: false };
  } catch (e) {
    console.error("LLM rules extraction failed:", (e as Error).message);
    return { parsed, usedLlm: false };
  }
}

/** Facts open to US residents? Unknown counts as yes (most listings don't say). */
export function openToUs(parsed: ParsedRules | null): boolean {
  return !parsed || parsed.countries.length === 0 || parsed.countries.includes("US");
}

export interface CatalogInput {
  /** Where users enter: the sponsor page when known, else the listing page. */
  url: string;
  title: string;
  rulesUrl?: string | null;
  description?: string | null;
  prizeSummary?: string | null;
  categories?: string[];
  parsed?: ParsedRules | null;
  frequencyHint?: Frequency | null;
  submittedByUserId?: string | null;
  usedLlm?: boolean;
}

type SweepsInsert = typeof sweepstakes.$inferInsert;
type SweepsRow = typeof sweepstakes.$inferSelect;

/** Parsed dates are noon UTC on the calendar day; treat the end date as end-of-day ET. */
export function endOfDay(d: Date | null | undefined): Date | null {
  if (!d) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 3, 59, 59));
}

function columnsFrom(input: CatalogInput): Omit<SweepsInsert, "canonicalUrl" | "url" | "title"> {
  const p = input.parsed;
  return {
    rulesUrl: input.rulesUrl ?? null,
    description: input.description?.slice(0, 4000) ?? null,
    prizeSummary: input.prizeSummary?.slice(0, 500) ?? null,
    categories: input.categories?.slice(0, 20) ?? [],
    sponsor: p?.sponsor ?? null,
    totalArvCents: p?.totalArv != null ? Math.round(p.totalArv * 100) : null,
    startsAt: p?.startsAt ?? null,
    endsAt: endOfDay(p?.endsAt),
    // Left undefined without evidence so the column default applies and merges don't overwrite.
    frequency: p?.frequency ?? input.frequencyHint ?? undefined,
    minAge: p?.minAge ?? null,
    countries: p?.countries ?? [],
    excludedStates: p?.excludedStates ?? [],
    amoe: p?.amoe.available ? p.amoe : null,
    parseConfidence: p?.confidence ?? null,
    submittedByUserId: input.submittedByUserId ?? null,
    llmEnrichedAt: input.usedLlm ? new Date() : null,
  };
}

const isEmpty = (v: unknown) => v === null || v === undefined || (Array.isArray(v) && v.length === 0);

/** Patch only fields the existing row lacks, so earlier (or human) data is never clobbered. */
function fillGaps(existing: SweepsRow, incoming: ReturnType<typeof columnsFrom>): Partial<SweepsInsert> {
  const patch: Partial<SweepsInsert> = {};
  for (const [k, v] of Object.entries(incoming) as [keyof typeof incoming, unknown][]) {
    if (k === "submittedByUserId" || k === "frequency") continue;
    if (isEmpty(existing[k as keyof SweepsRow]) && !isEmpty(v)) (patch as Record<string, unknown>)[k] = v;
  }
  // Frequency always has a value, so only replace it when the existing one wasn't parsed from evidence.
  if (incoming.frequency && incoming.frequency !== existing.frequency && !existing.parseConfidence?.frequency) {
    patch.frequency = incoming.frequency;
  }
  return patch;
}

/**
 * Insert or merge a catalog record. Dedups on the canonical entry URL, and also on a
 * listing URL this source has already mapped (so a listing that later reveals its
 * sponsor link doesn't create a second record).
 */
export async function upsertCatalog(
  input: CatalogInput,
  source: { sourceId: string; externalUrl?: string },
): Promise<{ id: string; created: boolean }> {
  const canonical = canonicalUrl(input.url);
  let existing = await db.query.sweepstakes.findFirst({ where: eq(sweepstakes.canonicalUrl, canonical) });
  if (!existing && source.externalUrl && source.externalUrl !== input.url) {
    const viaListing = await db.query.sweepstakes.findFirst({ where: eq(sweepstakes.canonicalUrl, canonicalUrl(source.externalUrl)) });
    existing = viaListing;
  }

  const cols = columnsFrom(input);
  let id: string;
  let created = false;
  if (existing) {
    id = existing.id;
    const patch = existing.humanEditedAt ? {} : fillGaps(existing, cols);
    await db
      .update(sweepstakes)
      .set({ ...patch, lastCrawledAt: new Date(), updatedAt: new Date() })
      .where(eq(sweepstakes.id, id));
  } else {
    const [row] = await db
      .insert(sweepstakes)
      .values({ canonicalUrl: canonical, url: input.url, title: input.title.slice(0, 300), ...cols, lastCrawledAt: new Date() })
      .onConflictDoNothing({ target: sweepstakes.canonicalUrl })
      .returning();
    created = Boolean(row);
    id = row?.id ?? (await db.query.sweepstakes.findFirst({ where: eq(sweepstakes.canonicalUrl, canonical) }))!.id;
  }

  await db
    .insert(sweepstakesSources)
    .values({ sweepstakesId: id, sourceId: source.sourceId, externalUrl: source.externalUrl ?? input.url })
    .onConflictDoUpdate({ target: [sweepstakesSources.sweepstakesId, sweepstakesSources.sourceId], set: { seenAt: new Date() } });
  return { id, created };
}

export interface ImportResult {
  id: string;
  created: boolean;
  parsed: ParsedRules | null;
  warning?: string;
}

/** A user pasted a URL (or shared it to the app): analyze it and add it to the catalog. */
export async function importSweepstakes(
  url: string,
  opts: { userId?: string | null; sourceId?: string; title?: string } = {},
): Promise<ImportResult> {
  const canonical = canonicalUrl(url);
  const existing = await db.query.sweepstakes.findFirst({ where: eq(sweepstakes.canonicalUrl, canonical) });
  if (existing) {
    await upsertCatalog({ url, title: existing.title }, { sourceId: opts.sourceId ?? "user" });
    return { id: existing.id, created: false, parsed: null };
  }

  let analysis: PageAnalysis | null = null;
  let warning: string | undefined;
  try {
    analysis = await analyzePage(url);
    warning = analysis.warning;
    if (!openToUs(analysis.parsed)) warning = "These rules don't appear to be open to US residents.";
  } catch (e) {
    warning = `Couldn't fetch page, added with defaults: ${(e as Error).message}`;
  }
  const { id, created } = await upsertCatalog(
    {
      url,
      title: opts.title ?? analysis?.title ?? new URL(url).hostname,
      rulesUrl: analysis?.rulesUrl,
      parsed: analysis?.parsed,
      submittedByUserId: opts.userId ?? null,
      usedLlm: analysis?.usedLlm,
    },
    { sourceId: opts.sourceId ?? "user" },
  );
  return { id, created, parsed: analysis?.parsed ?? null, warning };
}

/** Re-read a catalog item's page and rules (the sponsor-page crawler), filling any gaps. */
export async function refreshSweepstakes(id: string): Promise<void> {
  const row = await db.query.sweepstakes.findFirst({ where: eq(sweepstakes.id, id) });
  if (!row || row.humanEditedAt) return;
  try {
    const a = await analyzePage(row.url, { polite: true });
    await upsertCatalog({ url: row.url, title: row.title, rulesUrl: a.rulesUrl, parsed: a.parsed, usedLlm: a.usedLlm }, { sourceId: "crawler" });
  } catch {
    await db.update(sweepstakes).set({ lastCrawledAt: new Date() }).where(and(eq(sweepstakes.id, id)));
  }
}
