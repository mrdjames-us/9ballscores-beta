import { useEffect, useState, type ReactNode } from "react";
import { clsx } from "clsx";
import {
  createScorebook,
  linkScorebook,
  pushCloud,
  readSyncCode,
  reportCloudStatus,
  subscribeCloudStatus,
  SYNC_AT_KEY,
  unlinkScorebook,
  type CloudStatus,
} from "@/lib/apa9/cloud";
import {
  cancelGoogleLink,
  confirmGoogleLink,
  googleSignIn,
  googleSignOut,
  googleSyncedAt,
  readLocalBackup,
  restoreLocalBackup,
  subscribeGoogleAccount,
  subscribeGoogleLink,
  syncGoogleAccount,
  type GoogleAccount,
  type GoogleLinkPrompt,
} from "@/lib/apa9/google";

function when(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function AccountPanel() {
  const [account, setAccount] = useState<GoogleAccount | null>(null);
  const [link, setLink] = useState<GoogleLinkPrompt | null>(null);
  const [syncCode, setSyncCode] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [syncedAt, setSyncedAt] = useState("");
  const [googleAt, setGoogleAt] = useState("");
  const [backupCount, setBackupCount] = useState(0);
  const [googleStatus, setGoogleStatus] = useState<CloudStatus | null>(null);
  const [syncStatus, setSyncStatus] = useState<CloudStatus | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);

  function refreshLocal() {
    setSyncCode(readSyncCode());
    setSyncedAt(localStorage.getItem(SYNC_AT_KEY) || "");
    setGoogleAt(googleSyncedAt());
    setBackupCount(readLocalBackup()?.history.length ?? 0);
  }

  useEffect(() => {
    refreshLocal();
    const offAccount = subscribeGoogleAccount((user) => {
      setAccount(user);
      refreshLocal();
    });
    const offLink = subscribeGoogleLink(setLink);
    const offStatus = subscribeCloudStatus((status) => {
      if (status.scope === "google") setGoogleStatus(status);
      else setSyncStatus(status);
      refreshLocal();
    });
    return () => {
      offAccount();
      offLink();
      offStatus();
    };
  }, []);

  return (
    <section className="border-line bg-elevated mt-4 rounded-xl border p-3">
      <h2 className="text-lg font-semibold">Google account</h2>
      <p className="text-muted mt-1 text-sm leading-relaxed">
        Same account as your current scorer. Matches already on this device are merged, not replaced.
      </p>
      {account ? (
        <div className="mt-3">
          <div className="flex items-center gap-3">
            {account.photoURL ? (
              <img src={account.photoURL} alt="" width={40} height={40} className="size-10 rounded-full" />
            ) : (
              <span className="bg-subtle size-10 rounded-full" />
            )}
            <div className="min-w-0">
              <p className="truncate font-semibold">{account.displayName || "Signed in"}</p>
              <p className="text-muted truncate text-sm">{account.email || account.uid}</p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" className="border-line h-11 rounded-md border text-sm font-medium" onClick={() => void googleSignOut()}>
              Sign out
            </button>
            <button
              type="button"
              className="bg-accent text-accent-fg h-11 rounded-md text-sm font-semibold"
              onClick={() => void syncGoogleAccount()}
            >
              Sync account
            </button>
            {backupCount > 0 && (
              <button
                type="button"
                className="border-line col-span-2 h-11 rounded-md border text-sm font-medium"
                onClick={() => setConfirmRestore(true)}
              >
                Restore backup ({backupCount})
              </button>
            )}
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="border-line mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-md border bg-accent font-semibold text-accent-fg"
          onClick={() => void googleSignIn()}
        >
          <GoogleMark />
          Sign in with Google
        </button>
      )}
      <StatusLine status={googleStatus} fallback={googleAt ? `Account last synced ${when(googleAt)}` : ""} />

      <h2 className="mt-5 text-lg font-semibold">Shared scorebook</h2>
      {syncCode ? (
        <div className="mt-2">
          <p className="text-muted text-sm">Enter this code on another device. No login required.</p>
          <p className="border-line mt-2 rounded-md border py-3 text-center text-2xl font-semibold tracking-widest tabular-nums">
            {syncCode}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              className="bg-accent text-accent-fg h-11 rounded-md text-sm font-semibold"
              onClick={() => void pushCloud({ silent: false })}
            >
              Sync now
            </button>
            <button
              type="button"
              className="border-line h-11 rounded-md border text-sm font-medium"
              onClick={() => {
                if (navigator.clipboard?.writeText) {
                  void navigator.clipboard.writeText(syncCode).then(
                    () => reportCloudStatus({ scope: "sync", message: "Code copied.", kind: "ok" }),
                    () => reportCloudStatus({ scope: "sync", message: "Could not copy. Select the code above.", kind: "err" }),
                  );
                }
              }}
            >
              Copy code
            </button>
            <button
              type="button"
              className="border-line col-span-2 h-11 rounded-md border text-sm font-medium"
              onClick={() => setConfirmUnlink(true)}
            >
              Unlink this device
            </button>
          </div>
        </div>
      ) : (
        <form
          className="mt-2 grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void linkScorebook(codeInput)
              .then(() => setCodeInput(""))
              .catch((error: unknown) => {
                reportCloudStatus({
                  scope: "sync",
                  message: error instanceof Error ? error.message : "Link failed",
                  kind: "err",
                });
              });
          }}
        >
          <label className="text-muted text-sm font-medium" htmlFor="sync-code">
            Enter an existing code
          </label>
          <input
            id="sync-code"
            className="border-line bg-subtle h-12 w-full rounded-md border px-3 tracking-wide uppercase"
            value={codeInput}
            maxLength={12}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder="ABCD-1234"
            onChange={(event) => setCodeInput(event.target.value.toUpperCase())}
          />
          <button type="submit" className="bg-accent text-accent-fg h-12 rounded-md font-semibold">
            Link
          </button>
          <button
            type="button"
            className="border-line h-12 rounded-md border font-semibold"
            onClick={() => {
              void createScorebook().catch((error: unknown) => {
                reportCloudStatus({
                  scope: "sync",
                  message: error instanceof Error ? error.message : "Could not create scorebook",
                  kind: "err",
                });
              });
            }}
          >
            Create new scorebook
          </button>
        </form>
      )}
      <StatusLine status={syncStatus} fallback={syncCode && syncedAt ? `Last synced ${when(syncedAt)}` : ""} />
      <p className="text-faint mt-3 text-xs leading-relaxed">
        Google keeps your history across devices. A sync code shares one scorebook on a bar phone without logging in.
        This device still works offline.
      </p>

      {link && (
        <Sheet title="Keep your match history">
          <p className="text-muted text-sm leading-relaxed">
            This device's scorebook will be attached to {link.email}. Nothing already here is deleted.
          </p>
          <ul className="text-muted mt-3 list-disc space-y-1 pl-5 text-sm">
            <li>
              This device: <span className="text-fg font-semibold">{link.localCount}</span> matches
            </li>
            <li>
              Google account:{" "}
              {link.remoteCount === null ? (
                "couldn't read yet — this device's matches stay"
              ) : (
                <span className="text-fg font-semibold">{link.remoteCount} matches</span>
              )}
            </li>
            <li>Result: unique matches from both sides. No deletes.</li>
          </ul>
          <div className="mt-4 grid gap-2">
            <button type="button" className="bg-accent text-accent-fg h-12 rounded-md font-semibold" onClick={() => void confirmGoogleLink()}>
              Keep history and attach Google
            </button>
            <button type="button" className="text-muted h-11 text-sm font-medium" onClick={() => void cancelGoogleLink()}>
              Cancel sign-in
            </button>
          </div>
        </Sheet>
      )}

      {confirmUnlink && (
        <Sheet title="Unlink this device?">
          <p className="text-muted text-sm leading-relaxed">
            The scorebook stays in the cloud. This device stops syncing until you link the code again.
          </p>
          <div className="mt-4 grid gap-2">
            <button
              type="button"
              className="bg-danger text-fg h-12 rounded-md font-semibold"
              onClick={() => {
                unlinkScorebook();
                setConfirmUnlink(false);
                refreshLocal();
              }}
            >
              Unlink
            </button>
            <button type="button" className="text-muted h-11 text-sm font-medium" onClick={() => setConfirmUnlink(false)}>
              Back
            </button>
          </div>
        </Sheet>
      )}

      {confirmRestore && (
        <Sheet title="Restore backup?">
          <p className="text-muted text-sm leading-relaxed">
            Puts the on-device backup back. It does not upload until you tap Sync account.
          </p>
          <div className="mt-4 grid gap-2">
            <button
              type="button"
              className="bg-accent text-accent-fg h-12 rounded-md font-semibold"
              onClick={() => {
                restoreLocalBackup();
                setConfirmRestore(false);
                refreshLocal();
              }}
            >
              Restore
            </button>
            <button type="button" className="text-muted h-11 text-sm font-medium" onClick={() => setConfirmRestore(false)}>
              Back
            </button>
          </div>
        </Sheet>
      )}
    </section>
  );
}

function StatusLine({ status, fallback }: { status: CloudStatus | null; fallback: string }) {
  const message = status?.message || fallback;
  if (!message) return null;
  return (
    <p
      className={clsx(
        "mt-2 text-sm",
        status?.kind === "err" && "text-danger",
        status?.kind === "ok" && "text-fg",
        !status?.kind && "text-muted",
      )}
    >
      {message}
    </p>
  );
}

function Sheet({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bg-bg/80 fixed inset-0 z-40 flex items-end justify-center px-3">
      <div role="dialog" aria-modal="true" aria-label={title} className="dock border-line bg-elevated mb-2 w-full max-w-lg rounded-xl border p-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        <div className="mt-2">{children}</div>
      </div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-5" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
