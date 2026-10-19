import type { EntrantProfileData } from "@sweeptrack/core";
import { api, getSettings, type Settings } from "./api";
import type { FieldMapping } from "./fill";

type Profile = EntrantProfileData & { id: string; isDefault: boolean };
interface DueItem { sweepstakesId: string; title: string; url: string; endsAt: string | null; profileId: string; profileName: string }
interface Lookup {
  match: null | {
    sweepstakesId: string;
    title: string;
    tracked: boolean;
    profiles: { profileId: string; profileName: string; due: boolean; nextEligibleAt: string | null }[];
  };
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = (msg: string) => ($("page-status").textContent = msg);

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function renderDue(items: DueItem[]) {
  const list = $("due");
  list.replaceChildren();
  $("due-count").textContent = `(${items.length})`;
  if (items.length === 0) {
    const li = document.createElement("li");
    li.textContent = "All caught up.";
    li.className = "muted";
    list.append(li);
  }
  for (const item of items) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = item.url;
    a.textContent = item.title;
    a.addEventListener("click", (e) => {
      e.preventDefault();
      void chrome.tabs.create({ url: item.url });
    });
    const who = document.createElement("span");
    who.className = "muted";
    who.textContent = item.profileName.split(" ")[0] ?? "";
    li.append(a, who);
    list.append(li);
  }
}

async function main() {
  const settings = await getSettings();
  const openOptions = (e: Event) => {
    e.preventDefault();
    void chrome.runtime.openOptionsPage();
  };
  $("open-options").addEventListener("click", openOptions);
  $("setup-link").addEventListener("click", openOptions);
  if (!settings) {
    $("setup").hidden = false;
    return;
  }
  $("main").hidden = false;

  const tab = await activeTab();
  const [{ profiles }, { due }, lookup] = await Promise.all([
    api<{ profiles: Profile[] }>(settings, "/api/ext/profiles"),
    api<{ due: DueItem[] }>(settings, "/api/ext/due"),
    tab?.url?.startsWith("http")
      ? api<Lookup>(settings, `/api/ext/lookup?url=${encodeURIComponent(tab.url)}`)
      : Promise.resolve<Lookup>({ match: null }),
  ]);
  renderDue(due);

  const select = $<HTMLSelectElement>("profile");
  for (const p of profiles) select.add(new Option(`${p.firstName} ${p.lastName}`, p.id, p.isDefault, p.isDefault));
  if (profiles.length === 0) status("Add an entrant profile in the web app first.");

  const match = lookup.match;
  if (match?.tracked) {
    const info = match.profiles.map((p) => `${p.profileName.split(" ")[0]}: ${p.due ? "due" : "entered"}`).join(" · ");
    $("page-info").textContent = `${match.title} — ${info}`;
    $("mark").hidden = false;
  } else {
    $("page-info").textContent = match ? `${match.title} (not tracked)` : "Not a tracked sweepstakes.";
    $("add").hidden = !tab?.url?.startsWith("http");
  }

  $("fill").addEventListener("click", () => void fillForm(settings, tab, profiles, select.value));
  $("learn").addEventListener("click", () => void learnForm(settings, tab, profiles, select.value));
  $("mark").addEventListener("click", () => void markEntered(settings, match!.sweepstakesId, select.value));
  $("add").addEventListener("click", () => void addPage(settings, tab));
}

function domainOf(tab: chrome.tabs.Tab | undefined): string | null {
  try {
    return tab?.url ? new URL(tab.url).hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

async function fillForm(settings: Settings, tab: chrome.tabs.Tab | undefined, profiles: Profile[], profileId: string) {
  const profile = profiles.find((p) => p.id === profileId);
  if (!tab?.id || !profile) return;
  try {
    const domain = domainOf(tab);
    const { mappings } = domain
      ? await api<{ mappings: FieldMapping[] }>(settings, `/api/ext/mappings?domain=${encodeURIComponent(domain)}`).catch(() => ({ mappings: [] }))
      : { mappings: [] };
    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["fill.js"] });
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: (p: EntrantProfileData, m: FieldMapping[]) =>
        (window as unknown as { __sweeptrackFill: (p: EntrantProfileData, m: FieldMapping[]) => { filled: number } }).__sweeptrackFill(p, m),
      args: [profile, mappings],
    });
    const filled = results.reduce((n, r) => n + ((r.result as { filled: number } | undefined)?.filled ?? 0), 0);
    status(filled ? `Filled ${filled} field(s). Review, solve any CAPTCHA, then click Submit.` : "No matching fields found on this page.");
  } catch (e) {
    status(`Couldn't fill this page: ${(e as Error).message}`);
  }
}

async function learnForm(settings: Settings, tab: chrome.tabs.Tab | undefined, profiles: Profile[], profileId: string) {
  const profile = profiles.find((p) => p.id === profileId);
  const domain = domainOf(tab);
  if (!tab?.id || !profile || !domain) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["fill.js"] });
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (p: EntrantProfileData) => (window as unknown as { __sweeptrackLearn: (p: EntrantProfileData) => FieldMapping[] }).__sweeptrackLearn(p),
      args: [profile],
    });
    const mappings = (res?.result as FieldMapping[] | undefined) ?? [];
    if (!mappings.length) return status("No fields on this page match your profile yet. Fill them in first.");
    await api(settings, "/api/ext/mappings", { method: "POST", body: JSON.stringify({ domain, mappings }) });
    status(`Remembered ${mappings.length} field(s) for ${domain}.`);
  } catch (e) {
    status(`Couldn't save: ${(e as Error).message}`);
  }
}

async function markEntered(settings: Settings, sweepstakesId: string, profileId: string) {
  try {
    await api(settings, "/api/ext/entries", { method: "POST", body: JSON.stringify({ sweepstakesId, profileId }) });
    status("Entry logged ✓");
    const { due } = await api<{ due: DueItem[] }>(settings, "/api/ext/due");
    renderDue(due);
  } catch (e) {
    status((e as Error).message);
  }
}

async function addPage(settings: Settings, tab: chrome.tabs.Tab | undefined) {
  if (!tab?.url) return;
  status("Adding and reading the rules…");
  try {
    const res = await api<{ warning: string | null }>(settings, "/api/ext/sweepstakes", {
      method: "POST",
      body: JSON.stringify({ url: tab.url, title: tab.title?.slice(0, 200) }),
    });
    status(res.warning ? `Tracked. ${res.warning}` : "Tracked ✓ Reopen the popup to log entries.");
    $("add").hidden = true;
  } catch (e) {
    status((e as Error).message);
  }
}

main().catch((e: Error) => {
  $("main").hidden = false;
  $("page-info").textContent = e.message;
});
