import { api, originPattern } from "./api";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function load() {
  const { apiBase, token } = await chrome.storage.local.get(["apiBase", "token"]);
  $<HTMLInputElement>("apiBase").value = (apiBase as string) ?? "http://localhost:4100";
  $<HTMLInputElement>("token").value = (token as string) ?? "";
}

$("save").addEventListener("click", async () => {
  const status = $("status");
  const apiBase = $<HTMLInputElement>("apiBase").value.trim().replace(/\/$/, "");
  const token = $<HTMLInputElement>("token").value.trim();
  try {
    // Host permission for the API origin is requested only for the server the user chose.
    const granted = await chrome.permissions.request({ origins: [originPattern(apiBase)] });
    if (!granted) throw new Error("Permission to reach the app was denied.");
    const { profiles } = await api<{ profiles: unknown[] }>({ apiBase, token }, "/api/ext/profiles");
    await chrome.storage.local.set({ apiBase, token });
    status.textContent = `Connected. ${profiles.length} entrant profile(s) found.`;
  } catch (e) {
    status.textContent = (e as Error).message;
  }
});

void load();
