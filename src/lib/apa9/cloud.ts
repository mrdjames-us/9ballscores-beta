import { loadHistory, loadProfiles, saveHistory, saveProfiles, type MatchRecord, type Profile } from "./storage.ts";

export const SYNC_KEY = "apa9SyncCodeV1";
export const SYNC_AT_KEY = "apa9SyncAtV1";

const BOOK_ORIGIN = "https://www.9ballscores.com";

export type CloudBook = {
  code?: string;
  profiles: Profile[];
  history: MatchRecord[];
  updatedAt?: string | null;
};

export type CloudStatus = {
  scope: "sync" | "google";
  message: string;
  kind: "" | "ok" | "err";
};

type PushOpts = { silent?: boolean; replace?: boolean };

type GoogleBridge = {
  signedIn: () => boolean;
  push: (opts: PushOpts) => Promise<void>;
};

let googleBridge: GoogleBridge | null = null;
let onLocalChange: (() => void) | null = null;
let replacePending = false;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
const statusListeners = new Set<(status: CloudStatus) => void>();

export function registerGoogleBridge(bridge: GoogleBridge | null) {
  googleBridge = bridge;
}

export function setBookChangeHandler(handler: (() => void) | null) {
  onLocalChange = handler;
}

export function subscribeCloudStatus(listener: (status: CloudStatus) => void) {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

export function reportCloudStatus(status: CloudStatus) {
  for (const listener of statusListeners) listener(status);
}

export function readSyncCode() {
  try {
    return (localStorage.getItem(SYNC_KEY) || "").toUpperCase();
  } catch {
    return "";
  }
}

export function writeSyncCode(code: string) {
  const clean = code.toUpperCase().replace(/[^A-Z0-9-]/g, "");
  try {
    if (clean) localStorage.setItem(SYNC_KEY, clean);
    else localStorage.removeItem(SYNC_KEY);
  } catch {
    /* private mode */
  }
}

export function formatSyncCode(raw: string): string | null {
  const norm = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (norm.length !== 8) return null;
  return `${norm.slice(0, 4)}-${norm.slice(4)}`;
}

function bookOrigin() {
  if (typeof location === "undefined") return BOOK_ORIGIN;
  const host = location.hostname;
  if (
    host === "www.9ballscores.com" ||
    host === "9ballscores.com" ||
    host === "9ballscores.pages.dev" ||
    host === "9ballscores-demo.pages.dev"
  ) {
    return "";
  }
  return BOOK_ORIGIN;
}

function endpoint(path: string) {
  return `${bookOrigin()}${path}`;
}

async function failMessage(response: Response, fallback: string) {
  try {
    const data = (await response.json()) as { error?: string };
    if (data.error) return data.error;
  } catch {
    /* body was not JSON */
  }
  return fallback;
}

export async function createRemoteBook(): Promise<CloudBook> {
  const response = await fetch(endpoint("/api/book"), { method: "POST" });
  if (!response.ok) throw new Error(await failMessage(response, `Create failed (${response.status})`));
  return (await response.json()) as CloudBook;
}

export async function getRemoteBook(code: string): Promise<CloudBook> {
  const response = await fetch(endpoint(`/api/book/${encodeURIComponent(code.replace(/-/g, ""))}`));
  if (response.status === 404) throw new Error("Scorebook not found — check the code.");
  if (!response.ok) throw new Error(await failMessage(response, `Load failed (${response.status})`));
  return (await response.json()) as CloudBook;
}

export async function putRemoteBook(
  code: string,
  payload: { profiles: Profile[]; history: MatchRecord[]; replace?: boolean },
): Promise<CloudBook> {
  const response = await fetch(endpoint(`/api/book/${encodeURIComponent(code.replace(/-/g, ""))}`), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (response.status === 404) throw new Error("Scorebook not found — check the code.");
  if (!response.ok) throw new Error(await failMessage(response, `Save failed (${response.status})`));
  return (await response.json()) as CloudBook;
}

export function applyCloudBook(book: CloudBook) {
  if (Array.isArray(book.profiles)) saveProfiles(book.profiles);
  if (Array.isArray(book.history)) saveHistory(book.history);
  if (book.updatedAt) {
    try {
      localStorage.setItem(SYNC_AT_KEY, book.updatedAt);
    } catch {
      /* ignore */
    }
  }
  if (book.code) writeSyncCode(book.code);
  onLocalChange?.();
}

export function clientMatchId(match: { id?: string; date?: string; names?: string[]; scores?: number[]; matchPts?: number[]; innings?: number }) {
  if (match?.id) return String(match.id);
  return [
    match.date || "",
    (match.names || []).join("|"),
    (match.scores || []).join("-"),
    (match.matchPts || []).join("-"),
    match.innings != null ? match.innings : "",
  ].join("::");
}

export function mergeProfiles(server: Profile[], client: Profile[]): Profile[] {
  const map = new Map<string, Profile>();
  function ingest(list: Profile[]) {
    for (const profile of list || []) {
      if (!profile?.name) continue;
      const key = profile.name.trim().toLowerCase();
      const prev = map.get(key);
      if (!prev) {
        map.set(key, { ...profile });
        continue;
      }
      const prevT = Date.parse(prev.lastPlayed || prev.created || "") || 0;
      const nextT = Date.parse(profile.lastPlayed || profile.created || "") || 0;
      if (nextT >= prevT) {
        map.set(key, {
          ...prev,
          ...profile,
          name: profile.name.trim() || prev.name,
          sl: profile.sl != null ? profile.sl : prev.sl,
          created: prev.created || profile.created,
          lastPlayed: profile.lastPlayed || prev.lastPlayed || null,
        });
      } else {
        map.set(key, {
          ...profile,
          ...prev,
          name: prev.name.trim() || profile.name,
          sl: prev.sl != null ? prev.sl : profile.sl,
          created: prev.created || profile.created,
        });
      }
    }
  }
  ingest(server);
  ingest(client);
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export function mergeHistory(server: MatchRecord[], client: MatchRecord[]): MatchRecord[] {
  const map = new Map<string, MatchRecord>();
  function ingest(list: MatchRecord[]) {
    for (const match of list || []) {
      if (!match) continue;
      const id = clientMatchId(match);
      const copy = { ...match, id: match.id || id };
      const prev = map.get(id);
      if (!prev) {
        map.set(id, copy);
        continue;
      }
      const prevT = Date.parse(prev.date || "") || 0;
      const nextT = Date.parse(copy.date || "") || 0;
      map.set(id, nextT >= prevT ? copy : prev);
    }
  }
  ingest(server);
  ingest(client);
  return [...map.values()]
    .sort((a, b) => (Date.parse(b.date || "") || 0) - (Date.parse(a.date || "") || 0))
    .slice(0, 500);
}

export function scheduleCloudPush(opts?: { replace?: boolean }) {
  if (typeof window === "undefined") return;
  if (opts?.replace) replacePending = true;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    const replace = replacePending;
    replacePending = false;
    pushTimer = null;
    void pushCloud({ silent: true, replace });
  }, 400);
}

export async function pushCloud(opts: PushOpts = {}) {
  const code = readSyncCode();
  if (!code && !googleBridge?.signedIn()) {
    if (!opts.silent) reportCloudStatus({ scope: "sync", message: "Not linked to a scorebook.", kind: "err" });
    return;
  }
  if (!code && googleBridge) {
    await googleBridge.push(opts);
    return;
  }
  if (!opts.silent) reportCloudStatus({ scope: "sync", message: "Syncing…", kind: "" });
  try {
    const book = await putRemoteBook(code, {
      profiles: loadProfiles(),
      history: loadHistory(),
      replace: !!opts.replace,
    });
    applyCloudBook(book);
    if (googleBridge?.signedIn()) await googleBridge.push({ silent: true, replace: opts.replace });
    if (!opts.silent) {
      reportCloudStatus({
        scope: "sync",
        message: `Synced ${new Date(book.updatedAt || Date.now()).toLocaleString()}`,
        kind: "ok",
      });
    }
  } catch (error) {
    if (!opts.silent) {
      reportCloudStatus({
        scope: "sync",
        message: error instanceof Error ? error.message : "Sync failed",
        kind: "err",
      });
    }
  }
}

export async function pullLinkedBook() {
  const code = readSyncCode();
  if (!code) return;
  try {
    await getRemoteBook(code);
    const merged = await putRemoteBook(code, { profiles: loadProfiles(), history: loadHistory() });
    applyCloudBook(merged);
  } catch (error) {
    console.warn("scorebook pull skipped", error);
  }
}

export async function createScorebook() {
  reportCloudStatus({ scope: "sync", message: "Creating scorebook…", kind: "" });
  const book = await createRemoteBook();
  if (!book.code) throw new Error("Create did not return a code.");
  writeSyncCode(book.code);
  const seeded = await putRemoteBook(book.code, { profiles: loadProfiles(), history: loadHistory() });
  applyCloudBook(seeded);
  reportCloudStatus({ scope: "sync", message: "Scorebook created. Save this code on your other devices.", kind: "ok" });
}

export async function linkScorebook(raw: string) {
  const code = formatSyncCode(raw);
  if (!code) throw new Error("Code must look like ABCD-1234 (8 characters).");
  reportCloudStatus({ scope: "sync", message: "Linking…", kind: "" });
  await getRemoteBook(code);
  writeSyncCode(code);
  const book = await putRemoteBook(code, { profiles: loadProfiles(), history: loadHistory() });
  applyCloudBook(book);
  reportCloudStatus({ scope: "sync", message: "Linked and merged with the scorebook.", kind: "ok" });
}

export function unlinkScorebook() {
  writeSyncCode("");
  try {
    localStorage.removeItem(SYNC_AT_KEY);
  } catch {
    /* ignore */
  }
  reportCloudStatus({ scope: "sync", message: "Unlinked. Local history on this device is unchanged.", kind: "ok" });
}
