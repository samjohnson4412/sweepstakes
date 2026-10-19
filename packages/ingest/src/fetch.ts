import { lookup } from "node:dns/promises";
import net from "node:net";
import { BOT_USER_AGENT, isAllowedByRobots, parseRobots, type RobotsRules } from "@sweeptrack/core";

export class RobotsDisallowedError extends Error {}

/**
 * Fetch a user-supplied URL with basic SSRF protection: http(s) only, public IPs only
 * (checked on every redirect hop), size and time limits.
 *
 * Production should additionally route crawler traffic through an egress proxy that
 * enforces the same policy at connect time (DNS rebinding can race the lookup below).
 */
export interface FetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  /** Pace requests per host and check robots.txt (crawler traffic). */
  polite?: boolean;
  /** With `polite`, set false to skip the robots.txt check but keep pacing. */
  robots?: boolean;
  accept?: string;
}

export async function fetchPublicPage(rawUrl: string, opts: FetchOptions = {}): Promise<{ finalUrl: string; html: string }> {
  const maxBytes = opts.maxBytes ?? 2_000_000;
  const maxRedirects = opts.maxRedirects ?? 3;
  let url = new URL(rawUrl);

  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicUrl(url);
    if (opts.polite) await politeGate(url, opts.robots ?? true);
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      headers: {
        "user-agent": USER_AGENT,
        accept: opts.accept ?? "text/html,application/xhtml+xml",
      },
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new Error(`Redirect without location from ${url}`);
      url = new URL(location, url);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    return { finalUrl: url.toString(), html: await readLimited(res, maxBytes) };
  }
  throw new Error("Too many redirects");
}

async function readLimited(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

async function assertPublicUrl(url: URL): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http(s) URLs are allowed");
  if (url.username || url.password) throw new Error("URLs with credentials are not allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (addresses.length === 0 || addresses.some(isPrivateIp)) throw new Error("URL resolves to a non-public address");
}

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  const v6 = ip.toLowerCase();
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIp(mapped[1]!);
  return v6 === "::" || v6 === "::1" || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || v6.startsWith("ff");
}

const USER_AGENT = `Mozilla/5.0 (compatible; ${BOT_USER_AGENT}/0.1; +https://sweeptrack.app/bot)`;
const MIN_HOST_INTERVAL_MS = Number(process.env.INGEST_MIN_HOST_INTERVAL_MS ?? 2_000);
const ROBOTS_TTL_MS = 6 * 3_600_000;

const robotsCache = new Map<string, { rules: RobotsRules; fetchedAt: number }>();
const hostQueue = new Map<string, Promise<void>>();

async function robotsFor(origin: string): Promise<RobotsRules> {
  const cached = robotsCache.get(origin);
  if (cached && Date.now() - cached.fetchedAt < ROBOTS_TTL_MS) return cached.rules;
  let rules: RobotsRules = { allow: [], disallow: [], crawlDelaySeconds: null };
  try {
    const res = await fetch(`${origin}/robots.txt`, { signal: AbortSignal.timeout(8_000), headers: { "user-agent": USER_AGENT } });
    // 4xx means "no restrictions"; 5xx/network errors mean "assume disallowed" per RFC 9309.
    if (res.ok) rules = parseRobots(await res.text());
    else if (res.status >= 500) rules = { allow: [], disallow: ["/"], crawlDelaySeconds: null };
  } catch {
    rules = { allow: [], disallow: ["/"], crawlDelaySeconds: null };
  }
  robotsCache.set(origin, { rules, fetchedAt: Date.now() });
  return rules;
}

/** Enforce robots.txt and a per-host minimum interval (or the site's Crawl-delay). */
async function politeGate(url: URL, checkRobots: boolean): Promise<void> {
  const rules = checkRobots ? await robotsFor(url.origin) : null;
  if (rules && !isAllowedByRobots(rules, url.pathname + url.search)) throw new RobotsDisallowedError(`robots.txt disallows ${url}`);
  const interval = Math.max(MIN_HOST_INTERVAL_MS, (rules?.crawlDelaySeconds ?? 0) * 1000);
  const prev = hostQueue.get(url.host) ?? Promise.resolve();
  const next = prev.then(() => new Promise<void>((r) => setTimeout(r, interval)));
  hostQueue.set(url.host, next.catch(() => {}));
  await prev;
}

/** Follow redirects (e.g. newsletter click-tracking links) to the final public URL without downloading bodies. */
export async function resolveRedirects(rawUrl: string, maxRedirects = 6): Promise<string> {
  let url = new URL(rawUrl);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicUrl(url);
    const res = await fetch(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(8_000), headers: { "user-agent": USER_AGENT } });
    await res.body?.cancel();
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) return url.toString();
    url = new URL(location, url);
  }
  return url.toString();
}
