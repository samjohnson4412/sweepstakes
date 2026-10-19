import { and, db, decryptSecret, encryptSecret, eq, inboundMessages, isNull, lt, mailAccounts, or } from "@sweeptrack/db";
import { htmlToText } from "@sweeptrack/core";
import { storeUserEmail } from "./messages";

/**
 * Gmail / Outlook connections. Gmail's read scope is "restricted": a public launch needs
 * Google OAuth verification plus an annual CASA security assessment. Until then, the
 * app works in Google "testing" mode for up to 100 listed test users.
 */
export type MailProvider = "google" | "microsoft";

const PROVIDERS = {
  google: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scope: "openid email https://www.googleapis.com/auth/gmail.readonly",
    clientId: () => process.env.GOOGLE_CLIENT_ID,
    clientSecret: () => process.env.GOOGLE_CLIENT_SECRET,
    extraAuthParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
  },
  microsoft: {
    authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scope: "openid email offline_access https://graph.microsoft.com/Mail.Read",
    clientId: () => process.env.MICROSOFT_CLIENT_ID,
    clientSecret: () => process.env.MICROSOFT_CLIENT_SECRET,
    extraAuthParams: { prompt: "select_account" },
  },
} as const;

/** Subjects worth importing from a connected mailbox. */
const GMAIL_QUERY =
  '{subject:winner subject:won subject:congratulations subject:prize subject:sweepstakes subject:giveaway subject:contest subject:affidavit subject:"claim your" subject:entry}';
const FIRST_SYNC_DAYS = 14;

export function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function providerConfigured(p: MailProvider): boolean {
  return Boolean(PROVIDERS[p].clientId() && PROVIDERS[p].clientSecret() && process.env.ENCRYPTION_KEY);
}

export function redirectUri(p: MailProvider): string {
  return `${appUrl()}/api/oauth/${p}/callback`;
}

export function buildAuthUrl(p: MailProvider, state: string): string {
  const cfg = PROVIDERS[p];
  const u = new URL(cfg.authUrl);
  u.search = new URLSearchParams({
    client_id: cfg.clientId()!,
    redirect_uri: redirectUri(p),
    response_type: "code",
    scope: cfg.scope,
    state,
    ...cfg.extraAuthParams,
  }).toString();
  return u.toString();
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in: number;
  error?: string;
}

async function tokenRequest(p: MailProvider, params: Record<string, string>): Promise<TokenResponse> {
  const cfg = PROVIDERS[p];
  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: cfg.clientId()!, client_secret: cfg.clientSecret()!, ...params }),
  });
  const json = (await res.json()) as TokenResponse & { error_description?: string };
  if (!res.ok) throw new OAuthError(json.error ?? `HTTP ${res.status}`, json.error_description);
  return json;
}

export class OAuthError extends Error {
  constructor(public code: string, description?: string) {
    super(description ? `${code}: ${description}` : code);
  }
}

/** The id_token came straight from the provider's token endpoint over TLS, so its claims are trusted without re-verifying the signature. */
function emailFromIdToken(idToken: string | undefined): string | null {
  const payload = idToken?.split(".")[1];
  if (!payload) return null;
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { email?: string; preferred_username?: string };
  return claims.email ?? claims.preferred_username ?? null;
}

/** Finish the OAuth flow and store (or refresh) the user's connected mailbox. */
export async function connectMailAccount(userId: string, p: MailProvider, code: string): Promise<string> {
  const tokens = await tokenRequest(p, { grant_type: "authorization_code", code, redirect_uri: redirectUri(p) });
  if (!tokens.refresh_token) throw new OAuthError("no_refresh_token", "The provider didn't return offline access. Remove the app's access and try again.");
  const email = emailFromIdToken(tokens.id_token) ?? "unknown";
  await db
    .insert(mailAccounts)
    .values({ userId, provider: p, email, refreshTokenEnc: encryptSecret(tokens.refresh_token) })
    .onConflictDoUpdate({
      target: [mailAccounts.userId, mailAccounts.provider, mailAccounts.email],
      set: { refreshTokenEnc: encryptSecret(tokens.refresh_token), status: "active", lastError: null },
    });
  return email;
}

interface SimpleMessage {
  id: string;
  from: string;
  subject: string;
  text: string;
  html: string | null;
}

// ---------- Gmail ----------

interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
  headers?: { name: string; value: string }[];
}

function findPart(part: GmailPart, mime: string): string | null {
  if (part.mimeType === mime && part.body?.data) return Buffer.from(part.body.data, "base64url").toString("utf8");
  for (const p of part.parts ?? []) {
    const found = findPart(p, mime);
    if (found) return found;
  }
  return null;
}

async function gmailMessages(accessToken: string, since: Date): Promise<SimpleMessage[]> {
  const auth = { authorization: `Bearer ${accessToken}` };
  const q = `${GMAIL_QUERY} after:${Math.floor(since.getTime() / 1000)}`;
  const list = (await (await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=50&q=${encodeURIComponent(q)}`, { headers: auth })).json()) as {
    messages?: { id: string }[];
  };
  const out: SimpleMessage[] = [];
  for (const { id } of list.messages ?? []) {
    const msg = (await (await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, { headers: auth })).json()) as {
      payload: GmailPart;
    };
    const header = (n: string) => msg.payload.headers?.find((h) => h.name.toLowerCase() === n)?.value ?? "";
    const html = findPart(msg.payload, "text/html");
    out.push({ id, from: header("from"), subject: header("subject"), text: findPart(msg.payload, "text/plain") ?? htmlToText(html ?? ""), html });
  }
  return out;
}

// ---------- Microsoft Graph ----------

async function graphMessages(accessToken: string, since: Date): Promise<SimpleMessage[]> {
  const url = new URL("https://graph.microsoft.com/v1.0/me/messages");
  url.search = new URLSearchParams({
    $filter: `receivedDateTime ge ${since.toISOString()}`,
    $select: "id,subject,from,body",
    $top: "50",
    $orderby: "receivedDateTime desc",
  }).toString();
  const res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}`, prefer: 'outlook.body-content-type="html"' } });
  if (!res.ok) throw new Error(`Graph HTTP ${res.status}`);
  const json = (await res.json()) as {
    value: { id: string; subject: string | null; from?: { emailAddress?: { name?: string; address?: string } }; body?: { content?: string } }[];
  };
  return json.value.map((m) => {
    const html = m.body?.content ?? "";
    const from = m.from?.emailAddress;
    return { id: m.id, from: from ? `${from.name ?? ""} <${from.address ?? ""}>`.trim() : "", subject: m.subject ?? "", text: htmlToText(html), html };
  });
}

/** Pull recent sweepstakes-related mail from one connected mailbox. */
export async function syncMailAccount(accountId: string): Promise<{ stored: number }> {
  const account = await db.query.mailAccounts.findFirst({ where: eq(mailAccounts.id, accountId) });
  if (!account || account.status === "revoked") return { stored: 0 };
  const startedAt = new Date();
  try {
    const tokens = await tokenRequest(account.provider, { grant_type: "refresh_token", refresh_token: decryptSecret(account.refreshTokenEnc) });
    // Microsoft rotates refresh tokens; keep the newest.
    if (tokens.refresh_token) {
      await db.update(mailAccounts).set({ refreshTokenEnc: encryptSecret(tokens.refresh_token) }).where(eq(mailAccounts.id, account.id));
    }
    const since = account.lastSyncAt ? new Date(account.lastSyncAt.getTime() - 3_600_000) : new Date(Date.now() - FIRST_SYNC_DAYS * 86_400_000);
    const messages = account.provider === "google" ? await gmailMessages(tokens.access_token, since) : await graphMessages(tokens.access_token, since);
    let stored = 0;
    for (const m of messages) {
      const r = await storeUserEmail(account.userId, m, { source: account.provider, externalId: `${account.provider}:${m.id}`, onlyRelevant: true });
      if (r.stored) stored++;
    }
    await db.update(mailAccounts).set({ lastSyncAt: startedAt, status: "active", lastError: null }).where(eq(mailAccounts.id, account.id));
    return { stored };
  } catch (e) {
    const revoked = e instanceof OAuthError && e.code === "invalid_grant";
    await db
      .update(mailAccounts)
      .set({ status: revoked ? "revoked" : "error", lastError: (e as Error).message.slice(0, 500), lastSyncAt: startedAt })
      .where(eq(mailAccounts.id, account.id));
    return { stored: 0 };
  }
}

/** Sync every active mailbox not synced in the last 15 minutes. */
export async function syncDueMailAccounts(deadline: number): Promise<number> {
  const due = await db
    .select({ id: mailAccounts.id })
    .from(mailAccounts)
    .where(
      and(
        or(eq(mailAccounts.status, "active"), eq(mailAccounts.status, "error")),
        or(isNull(mailAccounts.lastSyncAt), lt(mailAccounts.lastSyncAt, new Date(Date.now() - 15 * 60_000))),
      ),
    );
  let stored = 0;
  for (const { id } of due) {
    if (Date.now() > deadline) break;
    stored += (await syncMailAccount(id)).stored;
  }
  return stored;
}

/** Remove a connection and the messages synced from it. */
export async function disconnectMailAccount(userId: string, accountId: string): Promise<void> {
  const account = await db.query.mailAccounts.findFirst({ where: and(eq(mailAccounts.id, accountId), eq(mailAccounts.userId, userId)) });
  if (!account) return;
  await db.delete(inboundMessages).where(and(eq(inboundMessages.userId, userId), eq(inboundMessages.source, account.provider)));
  await db.delete(mailAccounts).where(eq(mailAccounts.id, account.id));
}
