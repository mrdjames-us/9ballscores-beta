import {
  mergeHistory,
  mergeProfiles,
  pullLinkedBook,
  registerGoogleBridge,
  reportCloudStatus,
  type CloudBook,
} from "./cloud.ts";
import { loadHistory, loadProfiles, saveHistory, saveProfiles, type MatchRecord, type Profile } from "./storage.ts";

export const GOOGLE_AT_KEY = "apa9GoogleSyncAtV1";
export const GOOGLE_BACKUP_KEY = "apa9GoogleBackupV1";
export const GOOGLE_LINKED_KEY = "apa9GoogleLinkedUidV1";

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyB9USmNYqxKu6_tNXw0Go-ewIAGjy5gdYs",
  authDomain: "apa-coach.firebaseapp.com",
  projectId: "apa-coach",
  storageBucket: "apa-coach.firebasestorage.app",
  messagingSenderId: "672777910668",
  appId: "1:672777910668:web:ec27fe86e1f32dcc93bea9",
};

export type GoogleAccount = {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
};

export type LocalBackup = {
  at: string;
  reason: string;
  uid: string | null;
  history: MatchRecord[];
  profiles: Profile[];
};

type DocSnap = { exists: boolean; data: () => Record<string, unknown> | undefined };
type DocRef = {
  get: () => Promise<DocSnap>;
  set: (data: object, opts?: { merge?: boolean }) => Promise<void>;
};
type FirebaseCompat = {
  apps: unknown[];
  initializeApp: (config: Record<string, string>) => void;
  auth: {
    (): {
      getRedirectResult: () => Promise<unknown>;
      onAuthStateChanged: (cb: (user: GoogleAccount | null) => void) => void;
      signInWithPopup: (provider: unknown) => Promise<unknown>;
      signOut: () => Promise<void>;
    };
    GoogleAuthProvider: new () => { setCustomParameters: (params: Record<string, string>) => void };
  };
  firestore: () => {
    collection: (name: string) => {
      doc: (id: string) => {
        collection: (name: string) => { doc: (id: string) => DocRef };
      };
    };
  };
};

declare global {
  interface Window {
    firebase?: FirebaseCompat;
  }
}

const accountListeners = new Set<(user: GoogleAccount | null) => void>();
let account: GoogleAccount | null = null;
let ready: Promise<void> | null = null;
let linkPending = false;
let mergeBusy = false;
let booksChanged: (() => void) | null = null;

const linkListeners = new Set<(pending: GoogleLinkPrompt | null) => void>();

export type GoogleLinkPrompt = {
  email: string;
  localCount: number;
  remoteCount: number | null;
};

export function scoreAppId() {
  if (typeof location === "undefined") return "nineball";
  const host = location.hostname;
  const demo =
    /(?:^|\.)9ballscores-demo\.pages\.dev$/i.test(host) ||
    /^demo\./i.test(host) ||
    host.endsWith(".vercel.app") ||
    /[?&]demo=1(?:&|$)/i.test(location.search);
  return demo ? "nineball-demo" : "nineball";
}

export function subscribeGoogleAccount(listener: (user: GoogleAccount | null) => void) {
  accountListeners.add(listener);
  listener(account);
  return () => accountListeners.delete(listener);
}

export function subscribeGoogleLink(listener: (prompt: GoogleLinkPrompt | null) => void) {
  linkListeners.add(listener);
  return () => linkListeners.delete(listener);
}

export function currentGoogleAccount() {
  return account;
}

function notifyAccount() {
  for (const listener of accountListeners) listener(account);
}

function notifyLink(prompt: GoogleLinkPrompt | null) {
  for (const listener of linkListeners) listener(prompt);
}

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const found = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement | null;
    if (found?.dataset.loaded === "1") {
      resolve();
      return;
    }
    if (found) {
      found.addEventListener("load", () => resolve(), { once: true });
      found.addEventListener("error", () => reject(new Error("Firebase failed to load")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = false;
    script.onload = () => {
      script.dataset.loaded = "1";
      resolve();
    };
    script.onerror = () => reject(new Error("Firebase failed to load"));
    document.head.appendChild(script);
  });
}

function firebase() {
  const fb = window.firebase;
  if (!fb) throw new Error("Firebase not ready.");
  return fb;
}

export function friendlyAuthError(error: unknown) {
  const coded = error as { code?: string; message?: string };
  const code = coded?.code || "";
  const host = typeof location === "undefined" ? "this site" : location.hostname;
  if (code === "auth/unauthorized-domain") {
    return `Firebase has not authorized this site (${host}). Add it under Authentication → Settings → Authorized domains.`;
  }
  if (code === "auth/popup-blocked") return "Popup blocked. Allow popups for this site and try again.";
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return "Sign-in cancelled.";
  if (code === "auth/operation-not-supported-in-this-environment") {
    return "This browser blocked Google sign-in. Open the page in Chrome or Safari.";
  }
  if (code === "auth/network-request-failed") return "Network error talking to Google. Check the connection and try again.";
  if (code === "permission-denied" || String(coded?.message || "").toLowerCase().includes("permission")) {
    return "Signed in, but Firestore blocked the save. Matches on this device are unchanged.";
  }
  return coded?.message || code || "Sign-in failed";
}

function linkedUid() {
  try {
    return localStorage.getItem(GOOGLE_LINKED_KEY) || "";
  } catch {
    return "";
  }
}

function setLinkedUid(uid: string) {
  try {
    if (uid) localStorage.setItem(GOOGLE_LINKED_KEY, uid);
    else localStorage.removeItem(GOOGLE_LINKED_KEY);
  } catch {
    /* ignore */
  }
}

export function readLocalBackup(): LocalBackup | null {
  try {
    const raw = localStorage.getItem(GOOGLE_BACKUP_KEY);
    if (!raw) return null;
    const backup = JSON.parse(raw) as LocalBackup;
    if (!backup || !Array.isArray(backup.history)) return null;
    return backup;
  } catch {
    return null;
  }
}

function snapshotLocalBackup(reason: string) {
  const history = loadHistory();
  const payload: LocalBackup = {
    at: new Date().toISOString(),
    reason,
    uid: account?.uid ?? null,
    history,
    profiles: loadProfiles(),
  };
  try {
    const prev = readLocalBackup();
    if (prev && prev.history.length > history.length) return prev;
    localStorage.setItem(GOOGLE_BACKUP_KEY, JSON.stringify(payload));
  } catch {
    /* quota */
  }
  return payload;
}

export function restoreLocalBackup() {
  const backup = readLocalBackup();
  if (!backup) {
    reportCloudStatus({ scope: "google", message: "No backup on this device.", kind: "err" });
    return false;
  }
  saveHistory(backup.history);
  if (Array.isArray(backup.profiles)) saveProfiles(backup.profiles);
  booksChanged?.();
  reportCloudStatus({
    scope: "google",
    message: `Restored ${backup.history.length} matches from backup. Tap Sync account to push to Google.`,
    kind: "ok",
  });
  return true;
}

function bookRef() {
  if (!account) return null;
  return firebase()
    .firestore()
    .collection("users")
    .doc(account.uid)
    .collection("scorebooks")
    .doc(scoreAppId());
}

async function readGoogleBook(): Promise<CloudBook> {
  const ref = bookRef();
  if (!ref) return { profiles: [], history: [] };
  const snap = await ref.get();
  if (!snap.exists) return { profiles: [], history: [], updatedAt: null };
  const data = snap.data() || {};
  return {
    profiles: Array.isArray(data.profiles) ? (data.profiles as Profile[]) : [],
    history: Array.isArray(data.history) ? (data.history as MatchRecord[]) : [],
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : null,
  };
}

async function applyGoogleMerge(opts: { silent?: boolean; replace?: boolean; reason?: string } = {}) {
  const ref = bookRef();
  if (!ref) return null;
  const localHistory = loadHistory();
  const localProfiles = loadProfiles();
  snapshotLocalBackup(opts.reason || "pre-google-merge");
  let remote: CloudBook = { profiles: [], history: [] };
  try {
    remote = await readGoogleBook();
  } catch (error) {
    if (!opts.silent) {
      reportCloudStatus({
        scope: "google",
        message: `Could not read Google scorebook (${friendlyAuthError(error)}). Keeping this device's matches.`,
        kind: "err",
      });
    }
  }
  const mergedHistory = opts.replace ? localHistory : mergeHistory(remote.history, localHistory);
  const mergedProfiles = opts.replace ? localProfiles : mergeProfiles(remote.profiles, localProfiles);
  if (!opts.replace && mergedHistory.length < localHistory.length) {
    reportCloudStatus({
      scope: "google",
      message: "Merge aborted — it would drop matches. This device's history is unchanged.",
      kind: "err",
    });
    return null;
  }
  saveProfiles(mergedProfiles);
  saveHistory(mergedHistory);
  booksChanged?.();
  const now = new Date().toISOString();
  try {
    const payload = { profiles: mergedProfiles, history: mergedHistory, updatedAt: now, app: scoreAppId() };
    if (opts.replace) await ref.set(payload);
    else await ref.set(payload, { merge: true });
    localStorage.setItem(GOOGLE_AT_KEY, now);
    if (account) setLinkedUid(account.uid);
    if (!opts.silent) {
      const added = Math.max(0, mergedHistory.length - localHistory.length);
      reportCloudStatus({
        scope: "google",
        message: added
          ? `Kept ${localHistory.length} local matches and added ${added} from Google (${mergedHistory.length} total).`
          : `Saved ${mergedHistory.length} matches to your Google account.`,
        kind: "ok",
      });
    }
    return payload;
  } catch (error) {
    reportCloudStatus({
      scope: "google",
      message: `Saved on this device, but Google save failed: ${friendlyAuthError(error)}`,
      kind: "err",
    });
    return null;
  }
}

async function onSignedIn(user: GoogleAccount) {
  if (linkPending) return;
  if (linkedUid() === user.uid) {
    await applyGoogleMerge({ silent: true, reason: "signed-in-resync" });
    return;
  }
  const localCount = loadHistory().length;
  if (localCount === 0) {
    await applyGoogleMerge({ silent: false, reason: "first-link-empty-local" });
    return;
  }
  linkPending = true;
  notifyLink({ email: user.email || "your Google account", localCount, remoteCount: null });
  let remoteCount: number | null = 0;
  try {
    const remote = await readGoogleBook();
    remoteCount = remote.history.length;
  } catch {
    remoteCount = null;
  }
  if (!linkPending) return;
  notifyLink({ email: user.email || "your Google account", localCount, remoteCount });
}

export async function ensureFirebase() {
  if (ready) return ready;
  ready = (async () => {
    await loadScript("https://www.gstatic.com/firebasejs/11.6.0/firebase-app-compat.js");
    await loadScript("https://www.gstatic.com/firebasejs/11.6.0/firebase-auth-compat.js");
    await loadScript("https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore-compat.js");
    const fb = firebase();
    if (!fb.apps.length) fb.initializeApp(FIREBASE_CONFIG);
    try {
      await fb.auth().getRedirectResult();
    } catch (error) {
      const coded = error as { code?: string };
      if (coded.code && coded.code !== "auth/popup-closed-by-user") {
        reportCloudStatus({ scope: "google", message: friendlyAuthError(error), kind: "err" });
      }
    }
    fb.auth().onAuthStateChanged((user) => {
      account = user;
      notifyAccount();
      if (user) void onSignedIn(user);
    });
    registerGoogleBridge({
      signedIn: () => Boolean(account) && !linkPending,
      push: (opts) => applyGoogleMerge({ silent: opts.silent, replace: opts.replace, reason: "cloud-push" }).then(() => undefined),
    });
  })().catch((error: unknown) => {
    ready = null;
    reportCloudStatus({ scope: "google", message: friendlyAuthError(error), kind: "err" });
    throw error;
  });
  return ready;
}

export function startCloud(onChange: () => void) {
  booksChanged = onChange;
  void ensureFirebase().catch(() => undefined);
  void pullLinkedBook();
  return () => {
    if (booksChanged === onChange) booksChanged = null;
  };
}

export async function googleSignIn() {
  await ensureFirebase();
  reportCloudStatus({ scope: "google", message: "Opening Google sign-in…", kind: "" });
  const provider = new (firebase().auth.GoogleAuthProvider)();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    await firebase().auth().signInWithPopup(provider);
  } catch (error) {
    const coded = error as { code?: string };
    reportCloudStatus({
      scope: "google",
      message: friendlyAuthError(error),
      kind: coded.code === "auth/popup-closed-by-user" ? "" : "err",
    });
  }
}

export async function googleSignOut() {
  linkPending = false;
  notifyLink(null);
  try {
    await firebase().auth().signOut();
    reportCloudStatus({ scope: "google", message: "Signed out. Local history on this device is unchanged.", kind: "" });
  } catch (error) {
    reportCloudStatus({ scope: "google", message: friendlyAuthError(error), kind: "err" });
  }
}

export async function confirmGoogleLink() {
  if (mergeBusy) return;
  mergeBusy = true;
  linkPending = false;
  notifyLink(null);
  reportCloudStatus({ scope: "google", message: "Merging this device's history into your Google account…", kind: "" });
  try {
    const result = await applyGoogleMerge({ silent: false, reason: "first-link-confirm" });
    if (result && account) setLinkedUid(account.uid);
  } finally {
    mergeBusy = false;
  }
}

export async function cancelGoogleLink() {
  linkPending = false;
  notifyLink(null);
  try {
    await firebase().auth().signOut();
  } catch {
    /* already signed out */
  }
  reportCloudStatus({ scope: "google", message: "Sign-in cancelled. Matches on this device are unchanged.", kind: "" });
}

export async function syncGoogleAccount() {
  await ensureFirebase();
  if (!account) {
    reportCloudStatus({ scope: "google", message: "Sign in first.", kind: "err" });
    return;
  }
  await applyGoogleMerge({ silent: false, reason: "manual-sync" });
}

export function googleSyncedAt() {
  try {
    return localStorage.getItem(GOOGLE_AT_KEY) || "";
  } catch {
    return "";
  }
}
