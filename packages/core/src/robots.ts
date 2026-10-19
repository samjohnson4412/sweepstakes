/** robots.txt parsing per RFC 9309 (longest match wins; Allow wins ties). */
export interface RobotsRules {
  allow: string[];
  disallow: string[];
  crawlDelaySeconds: number | null;
}

export const BOT_USER_AGENT = "SweepTrackBot";

export function parseRobots(txt: string, userAgent = BOT_USER_AGENT): RobotsRules {
  type Group = { agents: string[]; allow: string[]; disallow: string[]; delay: number | null };
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], allow: [], disallow: [], delay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === "allow" && value) current.allow.push(value);
    else if (key === "disallow" && value) current.disallow.push(value);
    else if (key === "crawl-delay" && !Number.isNaN(Number(value))) current.delay = Number(value);
  }
  const ua = userAgent.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && ua.includes(a)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes("*"));
  return {
    allow: chosen.flatMap((g) => g.allow),
    disallow: chosen.flatMap((g) => g.disallow),
    crawlDelaySeconds: chosen.find((g) => g.delay !== null)?.delay ?? null,
  };
}

function patternToRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/** `pathAndQuery` is e.g. "/sweepstakes/foo?x=1". */
export function isAllowedByRobots(rules: RobotsRules, pathAndQuery: string): boolean {
  let best: { len: number; allow: boolean } | null = null;
  for (const [list, allow] of [
    [rules.allow, true],
    [rules.disallow, false],
  ] as const) {
    for (const p of list) {
      if (!patternToRegex(p).test(pathAndQuery)) continue;
      if (!best || p.length > best.len || (p.length === best.len && allow)) best = { len: p.length, allow };
    }
  }
  return best ? best.allow : true;
}
