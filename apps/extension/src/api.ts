export interface Settings {
  apiBase: string;
  token: string;
}

export async function getSettings(): Promise<Settings | null> {
  const { apiBase, token } = await chrome.storage.local.get(["apiBase", "token"]);
  return typeof apiBase === "string" && apiBase && typeof token === "string" && token ? { apiBase, token } : null;
}

export async function api<T>(settings: Settings, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(new URL(path, settings.apiBase), {
    ...init,
    headers: { authorization: `Bearer ${settings.token}`, "content-type": "application/json", ...init.headers },
  });
  if (!res.ok) throw new Error(res.status === 401 ? "Token rejected. Check settings." : `Request failed (${res.status})`);
  return (await res.json()) as T;
}

/** Origin pattern for chrome.permissions, e.g. "https://app.example.com/*". */
export function originPattern(apiBase: string): string {
  const u = new URL(apiBase);
  return `${u.protocol}//${u.hostname}/*`;
}
