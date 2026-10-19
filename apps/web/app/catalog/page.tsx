import Link from "next/link";
import { FREQUENCIES } from "@sweeptrack/core";
import {
  and,
  arrayContains,
  db,
  desc,
  entrantProfiles,
  eq,
  gte,
  ilike,
  isNotNull,
  isNull,
  lte,
  not,
  or,
  sql,
  sweepstakes,
  trackedSweepstakes,
  type SQL,
} from "@sweeptrack/db";
import { requireUser } from "@/lib/auth";
import { FREQUENCY_LABEL, fmtDate, money, relDays } from "@/lib/format";
import { trackFromCatalog } from "../actions";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;

type Search = { q?: string; freq?: string; minArv?: string; ending?: string; state?: string; amoe?: string; sort?: string; page?: string; hideTracked?: string };

export default async function CatalogPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const defaultProfile = await db.query.entrantProfiles.findFirst({
    where: eq(entrantProfiles.userId, user.id),
    orderBy: desc(entrantProfiles.isDefault),
  });
  // Default to filtering by the entrant's state; "any" turns it off.
  const state = sp.state === undefined ? (defaultProfile?.state?.toUpperCase() ?? "") : sp.state === "any" ? "" : sp.state.toUpperCase();
  const page = Math.max(1, Number(sp.page) || 1);
  const now = new Date();

  const where: SQL[] = [or(isNull(sweepstakes.endsAt), gte(sweepstakes.endsAt, now))!];
  if (sp.q?.trim()) {
    const term = `%${sp.q.trim().replace(/[%_]/g, "\\$&")}%`;
    where.push(or(ilike(sweepstakes.title, term), ilike(sweepstakes.sponsor, term), ilike(sweepstakes.description, term))!);
  }
  if (sp.freq && (FREQUENCIES as readonly string[]).includes(sp.freq)) where.push(sql`${sweepstakes.frequency} = ${sp.freq}`);
  if (Number(sp.minArv) > 0) where.push(gte(sweepstakes.totalArvCents, Math.round(Number(sp.minArv) * 100)));
  if (Number(sp.ending) > 0) where.push(isNotNull(sweepstakes.endsAt), lte(sweepstakes.endsAt, new Date(now.getTime() + Number(sp.ending) * 86_400_000)));
  if (/^[A-Z]{2}$/.test(state)) where.push(not(arrayContains(sweepstakes.excludedStates, [state])));
  if (sp.amoe) where.push(isNotNull(sweepstakes.amoe));
  if (sp.hideTracked) where.push(isNull(trackedSweepstakes.id));

  const order =
    sp.sort === "arv"
      ? [sql`${sweepstakes.totalArvCents} desc nulls last`]
      : sp.sort === "ending"
        ? [sql`${sweepstakes.endsAt} asc nulls last`]
        : [desc(sweepstakes.createdAt)];

  const rows = await db
    .select({ s: sweepstakes, trackedId: trackedSweepstakes.id, total: sql<number>`count(*) over()::int` })
    .from(sweepstakes)
    .leftJoin(trackedSweepstakes, and(eq(trackedSweepstakes.sweepstakesId, sweepstakes.id), eq(trackedSweepstakes.userId, user.id)))
    .where(and(...where))
    .orderBy(...order)
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);
  const total = rows[0]?.total ?? 0;
  const pageLink = (p: number) => `/catalog?${new URLSearchParams({ ...sp, page: String(p) } as Record<string, string>)}`;

  return (
    <div>
      <h1>Catalog</h1>
      <form className="card fields" method="get">
        <label style={{ gridColumn: "span 2" }}>
          Search
          <input name="q" defaultValue={sp.q} placeholder="Prize, brand, or keyword" />
        </label>
        <label>
          Frequency
          <select name="freq" defaultValue={sp.freq ?? ""}>
            <option value="">Any</option>
            {FREQUENCIES.map((f) => (
              <option key={f} value={f}>
                {FREQUENCY_LABEL[f]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Min prize value ($)
          <input name="minArv" type="number" min="0" defaultValue={sp.minArv} />
        </label>
        <label>
          Ending within
          <select name="ending" defaultValue={sp.ending ?? ""}>
            <option value="">Any time</option>
            <option value="3">3 days</option>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
          </select>
        </label>
        <label>
          Eligible in state
          <input name="state" defaultValue={state || "any"} maxLength={3} placeholder="TX or any" />
        </label>
        <label>
          Sort
          <select name="sort" defaultValue={sp.sort ?? "new"}>
            <option value="new">Newest</option>
            <option value="ending">Ending soonest</option>
            <option value="arv">Highest value</option>
          </select>
        </label>
        <div className="stack" style={{ alignContent: "end" }}>
          <label className="check">
            <input type="checkbox" name="amoe" value="1" defaultChecked={Boolean(sp.amoe)} /> Has mail-in
          </label>
          <label className="check">
            <input type="checkbox" name="hideTracked" value="1" defaultChecked={Boolean(sp.hideTracked)} /> Hide tracked
          </label>
        </div>
        <div style={{ alignSelf: "end" }}>
          <button>Filter</button>
        </div>
      </form>

      <p className="muted small">
        {total} open sweepstakes{state ? ` eligible in ${state}` : ""}. New listings arrive automatically from feeds, newsletters, and other members.
      </p>
      {rows.length === 0 ? (
        <div className="card empty">Nothing matches. Try removing a filter.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Sweepstakes</th>
                <th>Frequency</th>
                <th>Ends</th>
                <th>Value</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ s, trackedId }) => (
                <tr key={s.id}>
                  <td>
                    <Link href={`/sweepstakes/${s.id}`}>{s.title}</Link>
                    <div className="muted small">
                      {s.sponsor ?? new URL(s.url).hostname.replace(/^www\./, "")}
                      {s.amoe && <span className="badge good" style={{ marginLeft: 6 }}>mail-in</span>}
                      {s.minAge && s.minAge > 18 && <span className="badge" style={{ marginLeft: 6 }}>{s.minAge}+</span>}
                    </div>
                  </td>
                  <td>{FREQUENCY_LABEL[s.frequency]}</td>
                  <td>
                    {fmtDate(s.endsAt)} <span className="muted small">{relDays(s.endsAt)}</span>
                  </td>
                  <td>{money(s.totalArvCents)}</td>
                  <td>
                    {trackedId ? (
                      <span className="badge good">tracking</span>
                    ) : (
                      <form action={trackFromCatalog}>
                        <input type="hidden" name="sweepstakesId" value={s.id} />
                        <button className="small">Track</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="row" style={{ marginTop: 12 }}>
        {page > 1 && (
          <Link className="button small secondary" href={pageLink(page - 1)}>
            ← Previous
          </Link>
        )}
        {page * PAGE_SIZE < total && (
          <Link className="button small secondary" href={pageLink(page + 1)}>
            Next →
          </Link>
        )}
      </div>
    </div>
  );
}
