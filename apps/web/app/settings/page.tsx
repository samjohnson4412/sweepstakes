import { apiTokens, db, desc, entrantProfiles, eq, mailAccounts } from "@sweeptrack/db";
import { ActionForm } from "@/components/ActionForm";
import { requireUser } from "@/lib/auth";
import { inboundAddress, providerConfigured } from "@sweeptrack/ingest";
import { fmtDateTime } from "@/lib/format";
import { createToken, disconnectMail, revokeToken, saveProfile } from "../actions";

export const dynamic = "force-dynamic";

function ProfileFields({ p }: { p?: typeof entrantProfiles.$inferSelect }) {
  const f = (name: keyof typeof entrantProfiles.$inferSelect, label: string, type = "text", required = false) => (
    <label>
      {label}
      <input name={name} type={type} defaultValue={(p?.[name] as string | null) ?? ""} required={required} />
    </label>
  );
  return (
    <>
      {p && <input type="hidden" name="id" value={p.id} />}
      <div className="fields">
        {f("firstName", "First name", "text", true)}
        {f("lastName", "Last name", "text", true)}
        {f("email", "Email for entries", "email", true)}
        {f("phone", "Phone", "tel")}
        {f("address1", "Address")}
        {f("address2", "Apt / suite")}
        {f("city", "City")}
        {f("state", "State")}
        {f("zip", "ZIP")}
        {f("birthDate", "Birth date", "date")}
      </div>
    </>
  );
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ welcome?: string; mail?: string }> }) {
  const user = await requireUser();
  const { welcome, mail } = await searchParams;
  const [profiles, tokens, mailboxes] = await Promise.all([
    db.select().from(entrantProfiles).where(eq(entrantProfiles.userId, user.id)).orderBy(entrantProfiles.createdAt),
    db.select().from(apiTokens).where(eq(apiTokens.userId, user.id)).orderBy(desc(apiTokens.createdAt)),
    db.select().from(mailAccounts).where(eq(mailAccounts.userId, user.id)).orderBy(mailAccounts.createdAt),
  ]);
  const google = providerConfigured("google");
  const microsoft = providerConfigured("microsoft");

  return (
    <div>
      <h1>Settings</h1>
      {welcome && profiles.length === 0 && (
        <div className="notice">Welcome! Start by adding your entrant profile. It powers autofill and mail-in cards.</div>
      )}

      <h2>Entrant profiles</h2>
      <p className="small muted">
        Each person who enters gets a profile (plan: <strong>{user.plan}</strong>, {user.plan === "pro" ? "up to 5" : "1"} profile
        {user.plan === "pro" ? "s" : ""}). Many sweepstakes limit entries per person <em>and</em> per household.
      </p>
      <div className="stack">
        {profiles.map((p) => (
          <details key={p.id} className="card">
            <summary style={{ cursor: "pointer" }}>
              <strong>
                {p.firstName} {p.lastName}
              </strong>{" "}
              <span className="muted small">{p.email}</span> {p.isDefault && <span className="badge">default</span>}
            </summary>
            <div style={{ marginTop: 12 }}>
              <ActionForm action={saveProfile} submitLabel="Save profile">
                <ProfileFields p={p} />
              </ActionForm>
            </div>
          </details>
        ))}
        <div className="card">
          <strong>Add profile</strong>
          <ActionForm action={saveProfile} submitLabel="Add profile">
            <ProfileFields />
          </ActionForm>
        </div>
      </div>

      <h2>Email</h2>
      {mail && <div className="notice">{mail}</div>}
      <div className="card stack small">
        <div>
          <strong>Forwarding:</strong> send or auto-forward sweepstakes emails to <code>{inboundAddress(user.inboundToken)}</code>
        </div>
        <div>
          <strong>Connect your mailbox</strong> (read-only; we import only sweepstakes-related messages):
          <div className="row" style={{ marginTop: 6 }}>
            {google ? (
              <a className="button small secondary" href="/api/oauth/google/start">
                Connect Gmail
              </a>
            ) : (
              <span className="muted">Gmail not configured</span>
            )}
            {microsoft ? (
              <a className="button small secondary" href="/api/oauth/microsoft/start">
                Connect Outlook / Hotmail
              </a>
            ) : (
              <span className="muted">Outlook not configured</span>
            )}
          </div>
        </div>
        {mailboxes.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Mailbox</th>
                <th>Status</th>
                <th>Last sync</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {mailboxes.map((m) => (
                <tr key={m.id}>
                  <td>
                    {m.email} <span className="muted">({m.provider === "google" ? "Gmail" : "Outlook"})</span>
                  </td>
                  <td>
                    <span className={`badge ${m.status === "active" ? "good" : "bad"}`}>{m.status}</span>
                    {m.status === "revoked" && " Reconnect to resume."}
                    {m.lastError && m.status !== "active" && <div className="muted">{m.lastError}</div>}
                  </td>
                  <td>{fmtDateTime(m.lastSyncAt)}</td>
                  <td>
                    <form action={disconnectMail}>
                      <input type="hidden" name="id" value={m.id} />
                      <button className="small secondary">Disconnect</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2>Browser extension</h2>
      <div className="card stack">
        <p className="small muted" style={{ margin: 0 }}>
          Create a token and paste it into the SweepTrack extension&apos;s options, along with this site&apos;s URL.
        </p>
        <ActionForm action={createToken} submitLabel="Create token" className="row">
          <input name="name" placeholder="Token name (e.g. Chrome laptop)" />
        </ActionForm>
        {tokens.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Created</th>
                <th>Last used</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td>{fmtDateTime(t.createdAt)}</td>
                  <td>{fmtDateTime(t.lastUsedAt)}</td>
                  <td>
                    <form action={revokeToken}>
                      <input type="hidden" name="id" value={t.id} />
                      <button className="small secondary">Revoke</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
