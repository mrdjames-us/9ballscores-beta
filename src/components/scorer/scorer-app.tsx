import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { BookOpen, History, LayoutGrid, Users } from "lucide-react";
import { clsx } from "clsx";
import { AdSlot } from "@/components/scorer/ad-slot";
import { AccountPanel } from "@/components/scorer/account-panel";
import { scheduleCloudPush } from "@/lib/apa9/cloud";
import { startCloud } from "@/lib/apa9/google";
import {
  GOALS,
  MATCH_POINT_HEADER,
  MATCH_POINT_ROWS,
  createMatch,
  defense,
  foul,
  miss,
  pocket,
  resolveNine,
  toggleDead,
  topRuns,
  undo,
  type Seat,
  type Session,
} from "@/lib/apa9/engine";
import {
  careerStats,
  isGuest,
  loadAdConfig,
  loadHistory,
  loadProfiles,
  loadSession,
  nameKey,
  parseClient,
  parseSlot,
  recordFor,
  saveAdConfig,
  saveHistory,
  saveProfiles,
  saveSession,
  toRecord,
  type AdConfig,
  type MatchRecord,
  type Profile,
} from "@/lib/apa9/storage";

type Tab = "score" | "players" | "history" | "rules";

type Setup = {
  name: [string, string];
  sl: [number, number];
  guest: [boolean, boolean];
  lag: Seat;
};

type Dialog =
  | null
  | {
      kind: "confirm";
      title: string;
      body: string;
      confirm: string;
      danger?: boolean;
      run: () => void;
    }
  | { kind: "rename"; from: string };

const TABS: { id: Tab; label: string; icon: typeof LayoutGrid }[] = [
  { id: "score", label: "Score", icon: LayoutGrid },
  { id: "players", label: "Players", icon: Users },
  { id: "history", label: "History", icon: History },
  { id: "rules", label: "Rules", icon: BookOpen },
];

function emptySetup(): Setup {
  return { name: ["", ""], sl: [4, 4], guest: [false, false], lag: 0 };
}

function fmtWhen(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function buzz() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  navigator.vibrate?.(12);
}

export function ScorerApp() {
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>("score");
  const [setup, setSetup] = useState<Setup>(emptySetup);
  const [session, setSession] = useState<Session | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [history, setHistory] = useState<MatchRecord[]>([]);
  const [ads, setAds] = useState<AdConfig>({ client: "", slot: "" });
  const [dialog, setDialog] = useState<Dialog>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState("");
  const sessionRef = useRef<Session | null>(null);
  const reloadBooks = useCallback(() => {
    setProfiles(loadProfiles());
    setHistory(loadHistory());
  }, []);

  useEffect(() => {
    if (!ready) return;
    return startCloud(reloadBooks);
  }, [ready, reloadBooks]);

  useEffect(() => {
    const nextProfiles = loadProfiles();
    const nextHistory = loadHistory();
    const nextAds = loadAdConfig();
    setProfiles(nextProfiles);
    setHistory(nextHistory);
    setAds(nextAds);
    const saved = loadSession();
    if (saved) {
      const restored: Session = {
        state: saved.state,
        undo: saved.history,
        pendingNine: saved.pendingNine,
      };
      sessionRef.current = restored;
      setSession(restored);
    } else {
      const params = new URLSearchParams(window.location.search);
      const next = emptySetup();
      const p1 = (params.get("p1") || "").trim().slice(0, 20);
      const p2 = (params.get("p2") || "").trim().slice(0, 20);
      const p1sl = Number(params.get("p1sl"));
      const p2sl = Number(params.get("p2sl"));
      if (p1) next.name[0] = p1;
      if (p2) next.name[1] = p2;
      if (p1sl >= 1 && p1sl <= 9) next.sl[0] = p1sl;
      if (p2sl >= 1 && p2sl <= 9) next.sl[1] = p2sl;
      setSetup(next);
    }
    if (window.location.hash === "#history") setTab("history");
    else if (window.location.hash === "#rules") setTab("rules");
    else if (window.location.hash === "#players") setTab("players");
    setReady(true);
  }, []);

  function persistProfiles(rows: Profile[]) {
    setProfiles(rows);
    saveProfiles(rows);
    scheduleCloudPush();
  }

  function persistHistory(rows: MatchRecord[], opts?: { replace?: boolean }) {
    setHistory(rows);
    saveHistory(rows);
    scheduleCloudPush(opts?.replace ? { replace: true } : undefined);
  }

  function apply(next: Session) {
    const current = sessionRef.current;
    sessionRef.current = next;
    setSession(next);
    saveSession({ state: next.state, history: next.undo, pendingNine: next.pendingNine });
    if (current && current.state.winner === null && next.state.winner !== null) {
      const record = toRecord(next.state);
      if (record) {
        const merged = [record, ...loadHistory().filter((row) => row.id !== record.id)];
        persistHistory(merged);
      }
    }
    if (current && current.state.winner !== null && next.state.winner === null) {
      persistHistory(loadHistory().filter((row) => row.id !== current.state.id), { replace: true });
    }
  }

  function upsert(name: string, sl: number, touch: boolean) {
    const trimmed = name.trim().slice(0, 20);
    if (!trimmed) return;
    const rows = loadProfiles();
    const index = rows.findIndex((row) => nameKey(row.name) === nameKey(trimmed));
    if (index >= 0) {
      const current = rows[index]!;
      rows[index] = {
        ...current,
        sl,
        lastPlayed: touch ? new Date().toISOString() : current.lastPlayed,
      };
    } else {
      rows.push({
        name: trimmed,
        sl,
        created: new Date().toISOString(),
        lastPlayed: touch ? new Date().toISOString() : null,
      });
    }
    persistProfiles(rows);
  }

  function startMatch() {
    const names: [string, string] = [
      setup.name[0].trim().slice(0, 20) || (setup.guest[0] ? "Opponent" : "Player 1"),
      setup.name[1].trim().slice(0, 20) || (setup.guest[1] ? "Opponent" : "Player 2"),
    ];
    const sls: [number, number] = [setup.sl[0], setup.sl[1]];
    if (!setup.guest[0]) upsert(names[0], sls[0], true);
    if (!setup.guest[1]) upsert(names[1], sls[1], true);
    apply(createMatch(names, sls, setup.lag, setup.guest));
  }

  function askCancel() {
    if (!session) return;
    if (session.state.winner !== null) {
      setDialog({
        kind: "confirm",
        title: "Leave this result?",
        body: "The finished match stays in history.",
        confirm: "New match",
        run: () => {
          sessionRef.current = null;
          setSession(null);
          saveSession(null);
        },
      });
      return;
    }
    setDialog({
      kind: "confirm",
      title: "Cancel this match?",
      body: "Nothing is saved to history.",
      confirm: "Cancel match",
      danger: true,
      run: () => {
        sessionRef.current = null;
        setSession(null);
        saveSession(null);
      },
    });
  }

  function renamePlayer(from: string, to: string): string | null {
    const next = to.trim();
    if (!next) return "Name can't be empty.";
    if (next.length > 20) return "20 characters max.";
    const oldKey = nameKey(from);
    const newKey = nameKey(next);
    if (oldKey !== newKey) {
      const clash =
        history.some((match) =>
          [0, 1].some((seat) => !isGuest(match, seat) && nameKey(match.names[seat]) === newKey),
        ) || profiles.some((profile) => nameKey(profile.name) === newKey);
      if (clash) return `"${next}" already exists.`;
    }
    const nextHistory = history.map((match) => ({
      ...match,
      names: match.names.map((name) => (nameKey(name) === oldKey ? next : name)) as [string, string],
      topRuns: match.topRuns.map((run) => (nameKey(run.name) === oldKey ? { ...run, name: next } : run)),
    }));
    const nextProfiles = profiles.map((profile) =>
      nameKey(profile.name) === oldKey ? { ...profile, name: next } : profile,
    );
    persistHistory(nextHistory);
    persistProfiles(nextProfiles);
    return null;
  }

  function deletePlayer(name: string) {
    const key = nameKey(name);
    persistHistory(
      history.filter(
        (match) => ![0, 1].some((seat) => !isGuest(match, seat) && nameKey(match.names[seat]) === key),
      ),
      { replace: true },
    );
    persistProfiles(profiles.filter((profile) => nameKey(profile.name) !== key));
  }

  if (!ready) {
    return (
      <main className="bg-bg text-fg flex min-h-dvh flex-col px-5 pt-8">
        <p className="text-faint text-sm font-medium tracking-wide">APA 9-Ball</p>
        <h1 className="mt-1 text-lg font-semibold">Scorer</h1>
      </main>
    );
  }

  const live = session && tab === "score" && session.state.winner === null && !session.pendingNine;
  const finished = session && tab === "score" && session.state.winner !== null;

  return (
    <div className="bg-bg text-fg mx-auto flex h-dvh w-full max-w-lg flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {tab === "score" && !session && (
          <SetupView
            setup={setup}
            profiles={sortedProfiles(profiles)}
            onSetup={setSetup}
          />
        )}
        {tab === "score" && session && (
          <MatchView
            session={session}
            onPocket={(ball) => {
              buzz();
              apply(pocket(session, ball));
            }}
            onCancel={askCancel}
          />
        )}
        {tab === "players" && (
          <PlayersView
            profiles={sortedProfiles(profiles)}
            history={history}
            onAdd={(name, sl) => upsert(name, sl, false)}
            onSl={(name, sl) => upsert(name, sl, false)}
            onRename={(from) => {
              setRenameValue(from);
              setRenameError("");
              setDialog({ kind: "rename", from });
            }}
            onDelete={(name) =>
              setDialog({
                kind: "confirm",
                title: `Delete ${name}?`,
                body: "This removes the profile and every match they played.",
                confirm: "Delete",
                danger: true,
                run: () => deletePlayer(name),
              })
            }
          />
        )}
        {tab === "history" && (
          <HistoryView
            history={history}
            ads={ads}
            onRename={(from) => {
              setRenameValue(from);
              setRenameError("");
              setDialog({ kind: "rename", from });
            }}
            onDelete={(name) =>
              setDialog({
                kind: "confirm",
                title: `Delete ${name}?`,
                body: "This removes the profile and every match they played.",
                confirm: "Delete",
                danger: true,
                run: () => deletePlayer(name),
              })
            }
            onExport={() => {
              const blob = new Blob([JSON.stringify(history, null, 2)], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const link = document.createElement("a");
              link.href = url;
              link.download = "apa-9ball-history.json";
              link.click();
              URL.revokeObjectURL(url);
            }}
            onClear={() =>
              setDialog({
                kind: "confirm",
                title: "Clear all history?",
                body: "Saved players stay. Matches on this device are removed. A linked scorebook or Google account is cleared too.",
                confirm: "Clear history",
                danger: true,
                run: () => persistHistory([], { replace: true }),
              })
            }
          />
        )}
        {tab === "rules" && <RulesView ads={ads} onSave={setAds} />}
      </div>

      {tab === "score" && !session && (
        <div className="border-line border-t px-4 py-3">
          <button
            type="button"
            className="bg-accent text-accent-fg h-12 w-full rounded-md text-base font-semibold"
            onClick={startMatch}
          >
            Start match
          </button>
        </div>
      )}

      {live && session && (
        <div className="border-line grid grid-cols-6 gap-2 border-t px-3 py-3">
          <Action label="Miss" hint="Turn over" className="col-span-2" onClick={() => apply(miss(session))} />
          <Action label="Defense" hint="Mark it" className="col-span-2" onClick={() => apply(defense(session))} />
          <Action label="Foul" hint="Ball in hand" className="col-span-2 text-danger" onClick={() => apply(foul(session))} />
          <Action
            label={session.state.deadMode ? "Dead on" : "Dead ball"}
            hint="Then tap balls"
            className={clsx("col-span-3", session.state.deadMode && "border-danger text-danger")}
            onClick={() => apply(toggleDead(session))}
          />
          <Action
            label="Undo"
            hint={session.undo.length ? "Last action" : "Nothing yet"}
            className="col-span-3"
            disabled={!session.undo.length}
            onClick={() => apply(undo(session))}
          />
        </div>
      )}

      {finished && session && (
        <div className="border-line grid grid-cols-2 gap-2 border-t px-3 py-3">
          <button
            type="button"
            className="bg-accent text-accent-fg h-12 rounded-md font-semibold"
            onClick={() =>
              apply(
                createMatch(session.state.names, session.state.sls, session.state.lagWinner, session.state.guests),
              )
            }
          >
            Rematch
          </button>
          <button
            type="button"
            className="border-line bg-subtle h-12 rounded-md border font-semibold"
            onClick={askCancel}
          >
            New players
          </button>
        </div>
      )}

      <nav className="dock border-line grid grid-cols-4 border-t" aria-label="Sections">
        {TABS.map((item) => {
          const Icon = item.icon;
          const on = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className={clsx(
                "flex min-h-14 flex-col items-center justify-center gap-1 border-t-2 text-xs font-medium",
                on ? "border-felt text-fg" : "text-faint border-transparent",
              )}
              onClick={() => setTab(item.id)}
            >
              <Icon className="size-5" strokeWidth={1.75} aria-hidden="true" />
              {item.label}
            </button>
          );
        })}
      </nav>

      {session?.pendingNine && tab === "score" && (
        <Sheet title="9-ball pocketed">
          <p className="text-muted text-sm leading-relaxed">
            {session.pendingNine.mode === "earlyOrSnap"
              ? "No other balls were marked this rack. Was the 9 made on the break, or later?"
              : "The opponent never got to the table. Was the 9 made on the break itself?"}
          </p>
          <div className="mt-4 grid gap-2">
            <button
              type="button"
              className="bg-danger text-fg h-12 rounded-md font-semibold"
              onClick={() => apply(resolveNine(session, true))}
            >
              9 on the snap
            </button>
            <button
              type="button"
              className="bg-accent text-accent-fg h-12 rounded-md font-semibold"
              onClick={() => apply(resolveNine(session, false))}
            >
              {session.pendingNine.mode === "earlyOrSnap" ? "9 made early" : "Break and run"}
            </button>
            <button
              type="button"
              className="text-muted h-11 text-sm font-medium"
              onClick={() => apply(undo(session))}
            >
              Undo the 9
            </button>
          </div>
        </Sheet>
      )}

      {dialog?.kind === "confirm" && (
        <Sheet title={dialog.title}>
          <p className="text-muted text-sm leading-relaxed">{dialog.body}</p>
          <div className="mt-4 grid gap-2">
            <button
              type="button"
              className={clsx(
                "h-12 rounded-md font-semibold",
                dialog.danger ? "bg-danger text-fg" : "bg-accent text-accent-fg",
              )}
              onClick={() => {
                dialog.run();
                setDialog(null);
              }}
            >
              {dialog.confirm}
            </button>
            <button type="button" className="text-muted h-11 text-sm font-medium" onClick={() => setDialog(null)}>
              Back
            </button>
          </div>
        </Sheet>
      )}

      {dialog?.kind === "rename" && (
        <Sheet title={`Rename ${dialog.from}`}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const error = renamePlayer(dialog.from, renameValue);
              if (error) {
                setRenameError(error);
                return;
              }
              setDialog(null);
            }}
          >
            <input
              className="border-line bg-subtle h-12 w-full rounded-md border px-3"
              value={renameValue}
              maxLength={20}
              autoFocus
              onChange={(event) => setRenameValue(event.target.value)}
            />
            {renameError && <p className="text-danger mt-2 text-sm">{renameError}</p>}
            <button type="submit" className="bg-accent text-accent-fg mt-3 h-12 w-full rounded-md font-semibold">
              Save name
            </button>
            <button
              type="button"
              className="text-muted mt-1 h-11 w-full text-sm font-medium"
              onClick={() => setDialog(null)}
            >
              Back
            </button>
          </form>
        </Sheet>
      )}
    </div>
  );
}

function sortedProfiles(profiles: Profile[]) {
  return profiles.slice().sort((a, b) => {
    const left = a.lastPlayed || a.created || "";
    const right = b.lastPlayed || b.created || "";
    return left < right ? 1 : left > right ? -1 : 0;
  });
}

function Sheet({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bg-bg/80 fixed inset-0 z-40 flex items-end justify-center px-3" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="dock border-line bg-elevated mb-2 w-full max-w-lg rounded-xl border p-4"
      >
        <h2 className="text-lg font-semibold">{title}</h2>
        <div className="mt-2">{children}</div>
      </div>
    </div>
  );
}

function Action({
  label,
  hint,
  onClick,
  className,
  disabled,
}: {
  label: string;
  hint: string;
  onClick: () => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        "border-line bg-subtle min-h-14 rounded-md border px-2 py-2 text-sm font-semibold disabled:opacity-40",
        className,
      )}
    >
      {label}
      <span className="text-faint block text-xs font-medium">{hint}</span>
    </button>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-muted mb-1 block text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

const fieldClass = "border-line bg-subtle h-12 w-full rounded-md border px-3";

function SetupView({
  setup,
  profiles,
  onSetup,
}: {
  setup: Setup;
  profiles: Profile[];
  onSetup: (setup: Setup) => void;
}) {
  function patch(partial: Partial<Setup>) {
    onSetup({ ...setup, ...partial });
  }

  const [betaHost, setBetaHost] = useState(false);
  useEffect(() => {
    setBetaHost(window.location.hostname.endsWith(".vercel.app"));
  }, []);

  return (
    <div className="px-4 pt-6 pb-4">
      <p className="text-faint text-sm font-medium tracking-wide">Equalizer points</p>
      <h1 className="mt-1 text-lg font-semibold text-balance">New 9-ball match</h1>
      {betaHost && (
        <p className="text-muted mt-2 text-sm leading-relaxed">
          Beta for testers. The live scorer is not this site. Use a new scorebook code here, not a league one.
        </p>
      )}
      <p className="text-muted mt-2 text-sm leading-relaxed text-pretty">
        Balls 1–8 are 1 point. The 9 is 2. First player to their skill-level total wins.
      </p>
      <div className="mt-5 grid gap-4">
        {([0, 1] as const).map((seat) => (
          <section key={seat} className="border-line bg-elevated rounded-xl border p-3">
            <Field label={seat === 0 ? "Player 1" : "Player 2"}>
              <input
                className={fieldClass}
                maxLength={20}
                placeholder={setup.guest[seat] ? "Opponent" : seat === 0 ? "Player 1" : "Player 2"}
                value={setup.name[seat]}
                onChange={(event) => {
                  const name: [string, string] = [...setup.name];
                  name[seat] = event.target.value;
                  patch({ name });
                }}
              />
            </Field>
            {profiles.length > 0 && (
              <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                {profiles.map((profile) => {
                  const on = nameKey(profile.name) === nameKey(setup.name[seat]) && !setup.guest[seat];
                  return (
                    <button
                      key={profile.name}
                      type="button"
                      className={clsx(
                        "h-10 shrink-0 rounded-full border px-3 text-sm font-medium",
                        on ? "border-felt text-fg" : "border-line text-muted",
                      )}
                      onClick={() => {
                        const name: [string, string] = [...setup.name];
                        const sl: [number, number] = [...setup.sl];
                        const guest: [boolean, boolean] = [...setup.guest];
                        name[seat] = profile.name;
                        sl[seat] = profile.sl;
                        guest[seat] = false;
                        patch({ name, sl, guest });
                      }}
                    >
                      {profile.name}
                      <span className="text-faint"> · SL-{profile.sl}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="mt-3">
              <Field label="Skill level">
                <select
                  className={fieldClass}
                  value={setup.sl[seat]}
                  onChange={(event) => {
                    const sl: [number, number] = [...setup.sl];
                    sl[seat] = Number(event.target.value);
                    patch({ sl });
                  }}
                >
                  {Array.from({ length: 9 }, (_, index) => index + 1).map((level) => (
                    <option key={level} value={level}>
                      SL-{level} · {GOALS[level]} pts
                    </option>
                  ))}
                </select>
              </Field>
              <p className="text-faint mt-1 text-xs">Races to {GOALS[setup.sl[seat]]}</p>
            </div>
            <label className="text-muted mt-3 flex min-h-11 items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={setup.guest[seat]}
                onChange={(event) => {
                  const guest: [boolean, boolean] = [...setup.guest];
                  const name: [string, string] = [...setup.name];
                  guest[seat] = event.target.checked;
                  if (event.target.checked && !name[seat].trim()) name[seat] = "Opponent";
                  patch({ guest, name });
                }}
              />
              Guest — skip career stats
            </label>
          </section>
        ))}
      </div>
      <p className="text-muted mt-4 text-sm font-medium">Who won the lag?</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {([0, 1] as const).map((seat) => (
          <button
            key={seat}
            type="button"
            className={clsx(
              "min-h-14 rounded-md border px-3 py-2 text-left",
              setup.lag === seat ? "border-felt bg-subtle" : "border-line",
            )}
            onClick={() => patch({ lag: seat })}
          >
            <span className="block font-semibold">{setup.name[seat].trim() || `Player ${seat + 1}`}</span>
            <span className="text-faint text-xs">Breaks and shoots first</span>
          </button>
        ))}
      </div>
      <p className="text-faint mt-4 text-xs leading-relaxed">
        New players: men usually start SL-4, women SL-2. An established 8-ball rating is the 9-ball start.
      </p>
    </div>
  );
}

function MatchView({
  session,
  onPocket,
  onCancel,
}: {
  session: Session;
  onPocket: (ball: number) => void;
  onCancel: () => void;
}) {
  const { state } = session;
  const winner = state.winner;
  const loser = winner === null ? null : winner === 0 ? 1 : 0;

  return (
    <div className="px-4 pt-4 pb-4">
      <div className="grid grid-cols-2 gap-2">
        {([0, 1] as const).map((seat) => {
          const shooting = state.winner === null && state.current === seat;
          const pct = Math.min(100, (state.scores[seat] / state.goals[seat]) * 100);
          return (
            <section
              key={seat}
              className={clsx(
                "bg-elevated rounded-xl border p-3",
                shooting ? "border-felt" : "border-line",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-semibold">{state.names[seat]}</p>
                {state.winner === null && state.breaker === seat && (
                  <span className="text-faint shrink-0 text-xs font-medium">Breaks</span>
                )}
              </div>
              <p className="text-faint text-xs">SL-{state.sls[seat]}</p>
              <p className="mt-1 text-5xl leading-none font-semibold tabular-nums">{state.scores[seat]}</p>
              <p className="text-muted mt-1 text-xs">
                {Math.max(0, state.goals[seat] - state.scores[seat])} to go · {state.goals[seat]}
              </p>
              <div className="bg-subtle mt-2 h-1.5 overflow-hidden rounded-full">
                <div className="bg-felt h-full" style={{ width: `${pct}%` }} />
              </div>
              <p className="text-faint mt-2 text-xs tabular-nums">
                Def {state.defenses[seat]} · B&R {state.brs[seat]} · Snap {state.snaps[seat]}
              </p>
            </section>
          );
        })}
      </div>

      <p className="text-muted mt-3 text-sm tabular-nums">
        Rack {state.rackNum} · Inning {state.innings} · Run {state.currentRun} · Dead {state.deadTotal}
      </p>

      {winner !== null && loser !== null && state.matchPts && (
        <section className="border-line bg-elevated mt-4 rounded-xl border p-4">
          <h2 className="text-lg font-semibold">{state.names[winner]} wins</h2>
          <p className="mt-1 text-sm tabular-nums">
            {state.scores[winner]}–{state.scores[loser]} ball points
          </p>
          <p className="text-muted mt-1 text-sm">
            Match points {state.matchPts[winner]}–{state.matchPts[loser]}
          </p>
        </section>
      )}

      {winner === null && (
        <>
          <div className="mx-auto mt-4 grid w-full max-w-sm grid-cols-3 gap-3">
            {state.balls.map((mark, index) => {
              const ball = index + 1;
              const gone = mark !== "table";
              return (
                <button
                  key={ball}
                  type="button"
                  disabled={gone || Boolean(session.pendingNine)}
                  className={clsx("ball", `ball-${ball}`, gone && "ball-gone", mark === "dead" && "ball-dead")}
                  aria-label={state.deadMode ? `Mark the ${ball} dead` : `Pocket the ${ball}`}
                  onClick={() => onPocket(ball)}
                >
                  <span>{ball}</span>
                </button>
              );
            })}
          </div>
          <p className={clsx("mt-3 text-sm", state.deadMode ? "text-danger font-medium" : "text-muted")}>
            {state.deadMode
              ? "Dead-ball mode. Tap balls made on the foul, then tap Dead ball again. The 9 spots."
              : "Tap each ball the shooter pockets."}
          </p>
        </>
      )}

      {topRuns(state).length > 0 && (
        <ul className="mt-4 grid gap-1">
          {topRuns(state).map((run, index) => (
            <li key={`${run.p}-${run.len}-${index}`} className="text-muted text-sm">
              <span className="text-fg font-medium">{state.names[run.p]}</span>
              {` · ${run.len} ball${run.len === 1 ? "" : "s"}`}
              {run.live ? " · live" : ""}
            </li>
          ))}
        </ul>
      )}

      <div className="border-line mt-4 border-t pt-3">
        <ul className="grid max-h-28 gap-1 overflow-y-auto">
          {state.log.slice(0, 8).map((line, index) => (
            <li key={index} className="text-muted text-xs leading-relaxed">
              {line.map((part, partIndex) =>
                part.strong ? (
                  <strong key={partIndex} className="text-fg font-semibold">
                    {part.text}
                  </strong>
                ) : (
                  <span key={partIndex}>{part.text}</span>
                ),
              )}
            </li>
          ))}
        </ul>
        <button type="button" className="text-faint mt-3 text-sm font-medium" onClick={onCancel}>
          {winner === null ? "Cancel match" : "Close match"}
        </button>
      </div>
    </div>
  );
}

function PlayersView({
  profiles,
  history,
  onAdd,
  onSl,
  onRename,
  onDelete,
}: {
  profiles: Profile[];
  history: MatchRecord[];
  onAdd: (name: string, sl: number) => void;
  onSl: (name: string, sl: number) => void;
  onRename: (name: string) => void;
  onDelete: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const [sl, setSl] = useState(4);

  return (
    <div className="px-4 pt-6 pb-6">
      <h1 className="text-lg font-semibold">Players</h1>
      <p className="text-muted mt-1 text-sm">Skill level here is what the next match uses.</p>
      <form
        className="border-line bg-elevated mt-4 rounded-xl border p-3"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          if (!name.trim()) return;
          onAdd(name, sl);
          setName("");
        }}
      >
        <Field label="Name">
          <input className={fieldClass} maxLength={20} value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <div className="mt-3">
          <Field label="Skill level">
            <select className={fieldClass} value={sl} onChange={(event) => setSl(Number(event.target.value))}>
              {Array.from({ length: 9 }, (_, index) => index + 1).map((level) => (
                <option key={level} value={level}>
                  SL-{level} · {GOALS[level]} pts
                </option>
              ))}
            </select>
          </Field>
        </div>
        <button type="submit" className="bg-accent text-accent-fg mt-3 h-12 w-full rounded-md font-semibold">
          Save player
        </button>
      </form>
      {profiles.length === 0 ? (
        <p className="text-muted mt-6 text-sm">No saved players yet. Starting a match saves both names.</p>
      ) : (
        <ul className="mt-4 grid gap-2">
          {profiles.map((profile) => (
            <li key={profile.name} className="border-line bg-elevated rounded-xl border p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{profile.name}</p>
                  <p className="text-muted text-sm tabular-nums">{recordFor(history, profile.name)}</p>
                  <p className="text-faint text-xs">
                    {profile.lastPlayed ? `Last played ${fmtWhen(profile.lastPlayed)}` : "Not played yet"}
                  </p>
                </div>
                <select
                  className="border-line bg-subtle h-11 rounded-md border px-2 text-sm"
                  aria-label={`${profile.name} skill level`}
                  value={profile.sl}
                  onChange={(event) => onSl(profile.name, Number(event.target.value))}
                >
                  {Array.from({ length: 9 }, (_, index) => index + 1).map((level) => (
                    <option key={level} value={level}>
                      SL-{level}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className="border-line h-11 rounded-md border text-sm font-medium"
                  onClick={() => onRename(profile.name)}
                >
                  Rename
                </button>
                <button
                  type="button"
                  className="text-danger border-line h-11 rounded-md border text-sm font-medium"
                  onClick={() => onDelete(profile.name)}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function HistoryView({
  history,
  ads,
  onRename,
  onDelete,
  onExport,
  onClear,
}: {
  history: MatchRecord[];
  ads: AdConfig;
  onRename: (name: string) => void;
  onDelete: (name: string) => void;
  onExport: () => void;
  onClear: () => void;
}) {
  const careers = careerStats(history);
  return (
    <div className="px-4 pt-6 pb-6">
      <h1 className="text-lg font-semibold">History</h1>
      <p className="text-muted mt-1 text-sm">Stored on this device. Guests are left out of career totals.</p>
      <AccountPanel />
      {careers.length === 0 ? (
        <p className="text-muted mt-6 text-sm">No matches yet. Finish one and it lands here.</p>
      ) : (
        <ul className="mt-4 grid gap-2">
          {careers.map((row) => (
            <li key={row.name} className="border-line bg-elevated rounded-xl border p-3">
              <p className="font-semibold">{row.name}</p>
              <p className="text-muted mt-1 text-sm tabular-nums">
                {row.wins}-{row.matches - row.wins} · {Math.round((row.wins / row.matches) * 100)}% · {row.mp} match pts
              </p>
              <p className="text-faint mt-1 text-xs tabular-nums">
                {row.pts} ball pts · {row.def} defenses · {row.br} B&R · {row.snap} snaps · best run {row.bestRun}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className="border-line h-11 rounded-md border text-sm font-medium"
                  onClick={() => onRename(row.name)}
                >
                  Rename
                </button>
                <button
                  type="button"
                  className="text-danger border-line h-11 rounded-md border text-sm font-medium"
                  onClick={() => onDelete(row.name)}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {history.length > 0 && (
        <ul className="mt-4 grid gap-2">
          {history.map((match) => {
            const winner = match.winner;
            const loser = winner === 0 ? 1 : 0;
            return (
              <li key={match.id} className="border-line rounded-xl border p-3">
                <p className="text-faint text-xs">{fmtWhen(match.date)}</p>
                <p className="mt-1 text-sm">
                  <span className="font-semibold">{displayName(match, winner)}</span>
                  {` def. ${displayName(match, loser)}`}
                </p>
                <p className="text-muted text-sm tabular-nums">
                  {match.scores[winner]}–{match.scores[loser]} · match {match.matchPts[winner]}–{match.matchPts[loser]} ·{" "}
                  {match.innings} innings
                </p>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" className="border-line h-11 rounded-md border text-sm font-medium" onClick={onExport}>
          Export JSON
        </button>
        <button type="button" className="text-danger border-line h-11 rounded-md border text-sm font-medium" onClick={onClear}>
          Clear history
        </button>
      </div>
      <AdSlot client={ads.client} slot={ads.slot} />
    </div>
  );
}

function displayName(match: MatchRecord, seat: Seat) {
  return isGuest(match, seat) ? `${match.names[seat]} (guest)` : match.names[seat];
}

function RulesView({ ads, onSave }: { ads: AdConfig; onSave: (ads: AdConfig) => void }) {
  const [client, setClient] = useState(ads.client);
  const [slot, setSlot] = useState(ads.slot);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  return (
    <div className="px-4 pt-6 pb-8">
      <h1 className="text-lg font-semibold">Rules</h1>
      <p className="text-muted mt-1 text-sm leading-relaxed">
        Points format used on APA 9-ball scoresheets. Not affiliated with the American Poolplayers Association. Your
        league operator’s ruling wins.
      </p>
      <AdSlot client={ads.client} slot={ads.slot} />
      <Rule title="The game">
        <li>Play balls 1–9. The cue ball must hit the lowest ball first. Combos and slop count. Nothing is called.</li>
        <li>Lag winner shoots first. The winner of each rack breaks the next one.</li>
        <li>No push-out and no three-foul rule.</li>
      </Rule>
      <Rule title="Points">
        <li>Balls 1–8 are 1 point. The 9 is 2. Ten points in a rack.</li>
        <li>You win by reaching your points-to-win total before your opponent reaches theirs.</li>
        <li>Making the 9 ends the rack. Balls left up are dead.</li>
      </Rule>
      <div className="border-line mt-3 overflow-x-auto rounded-md border">
        <table className="w-full border-collapse text-center text-sm">
          <thead>
            <tr className="bg-subtle">
              <th className="px-2 py-2 font-medium">Skill</th>
              {Array.from({ length: 9 }, (_, index) => (
                <th key={index} className="px-2 py-2 font-medium tabular-nums">
                  {index + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th className="px-2 py-2 text-left font-medium">To win</th>
              {Array.from({ length: 9 }, (_, index) => (
                <td key={index} className="px-2 py-2 tabular-nums">
                  {GOALS[index + 1]}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <Rule title="Fouls and dead balls">
        <li>A foul is ball in hand anywhere. No point penalty.</li>
        <li>Balls made on a foul stay down and score for nobody. A 9 made on a foul is spotted.</li>
        <li>Every ball is scored or dead. Ten points per rack, accounted for.</li>
      </Rule>
      <Rule title="Innings, safeties, snap, break and run">
        <li>An inning ends when the lag loser misses, plays safe, or fouls.</li>
        <li>A defensive shot has no intent to pocket a ball. Mark it. It still ends the turn.</li>
        <li>9 on the snap is the 9 made on the break stroke.</li>
        <li>Break and run is breaking and clearing the rack before the opponent shoots.</li>
        <li>A 9 made early, after the break, ends the rack and is not a snap.</li>
      </Rule>
      <h2 className="mt-5 text-lg font-semibold">20 match points</h2>
      <p className="text-muted mt-1 text-sm leading-relaxed">
        Find the loser’s skill level, then the range that holds the loser’s ball points. That column is winner–loser.
      </p>
      <p className="text-faint mt-1 text-xs">Swipe the chart.</p>
      <div className="border-line mt-2 overflow-x-auto rounded-md border">
        <table className="w-full border-collapse text-center text-xs">
          <thead>
            <tr className="bg-subtle">
              <th className="px-2 py-2 text-left font-medium">SL</th>
              {MATCH_POINT_HEADER.map((label) => (
                <th key={label} className="px-2 py-2 font-medium">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MATCH_POINT_ROWS.map((row) => (
              <tr key={row.sl} className="border-line border-t">
                <th className="px-2 py-2 text-left font-medium tabular-nums">{row.sl}</th>
                {row.cells.map((cell) => (
                  <td key={cell} className="px-2 py-2 whitespace-nowrap tabular-nums">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form
        className="border-line mt-8 border-t pt-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!client.trim() && !slot.trim()) {
            const empty = { client: "", slot: "" };
            saveAdConfig(empty);
            onSave(empty);
            setError("");
            setNote("Ads are off on this device.");
            return;
          }
          const nextClient = parseClient(client);
          const nextSlot = parseSlot(slot);
          if (!nextClient) {
            setError("Publisher ID looks like ca-pub- and 16 digits.");
            setNote("");
            return;
          }
          if (!nextSlot) {
            setError("Slot ID is the number on the ad unit. Auto ads stay off so they never cover the balls.");
            setNote("");
            return;
          }
          const next = { client: nextClient, slot: nextSlot };
          saveAdConfig(next);
          onSave(next);
          setError("");
          setNote("Saved on this device. The unit shows on History and Rules only.");
        }}
      >
        <h2 className="text-lg font-semibold">AdSense</h2>
        <p className="text-muted mt-1 text-sm leading-relaxed">
          Optional. Paste your publisher ID and one display ad unit. Ads stay off the scoring screen so a player can’t
          tap one by mistake. They only fill on a domain you’ve added in AdSense, after you put an ads.txt file on that
          domain.
        </p>
        <div className="mt-3">
          <Field label="Publisher ID">
            <input
              className={fieldClass}
              inputMode="text"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="ca-pub-xxxxxxxxxxxxxxxx"
              value={client}
              onChange={(event) => setClient(event.target.value)}
            />
          </Field>
        </div>
        <div className="mt-3">
          <Field label="Ad unit slot ID">
            <input
              className={fieldClass}
              inputMode="numeric"
              placeholder="1234567890"
              value={slot}
              onChange={(event) => setSlot(event.target.value)}
            />
          </Field>
        </div>
        {error && <p className="text-danger mt-2 text-sm">{error}</p>}
        {note && <p className="text-felt mt-2 text-sm">{note}</p>}
        <button type="submit" className="bg-accent text-accent-fg mt-3 h-12 w-full rounded-md font-semibold">
          Save ad settings
        </button>
      </form>
    </div>
  );
}

function Rule({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5">
      <h2 className="text-lg font-semibold">{title}</h2>
      <ul className="text-muted mt-1 list-disc space-y-1 pl-5 text-sm leading-relaxed">{children}</ul>
    </section>
  );
}
