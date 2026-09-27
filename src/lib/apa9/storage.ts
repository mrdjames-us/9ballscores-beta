import type { MatchState, Seat } from "./engine.ts";
import { topRuns } from "./engine.ts";

export const STATE_KEY = "apa9StateV1";
export const HIST_KEY = "apa9HistoryV1";
export const PROF_KEY = "apa9ProfilesV1";
export const AD_KEY = "apa9AdsenseV1";

export type MatchRecord = {
  id: string;
  date: string;
  names: [string, string];
  sls: [number, number];
  guests: [boolean, boolean];
  goals: [number, number];
  scores: [number, number];
  matchPts: [number, number];
  winner: Seat;
  innings: number;
  defenses: [number, number];
  brs: [number, number];
  snaps: [number, number];
  deadTotal: number;
  racks: number;
  runs: [number[], number[]];
  topRuns: { name: string; len: number }[];
};

export type Profile = {
  name: string;
  sl: number;
  created: string;
  lastPlayed: string | null;
};

export type AdConfig = {
  client: string;
  slot: string;
};

export type SavedSession = {
  state: MatchState;
  history: MatchState[];
  pendingNine: { p: Seat; won: boolean; mode: "earlyOrSnap" | "snapOrBr" } | null;
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function loadHistory(): MatchRecord[] {
  const rows = read<MatchRecord[]>(HIST_KEY, []);
  return Array.isArray(rows) ? rows : [];
}

export function saveHistory(rows: MatchRecord[]) {
  write(HIST_KEY, rows);
}

export function loadProfiles(): Profile[] {
  const rows = read<Profile[]>(PROF_KEY, []);
  return Array.isArray(rows) ? rows : [];
}

export function saveProfiles(rows: Profile[]) {
  write(PROF_KEY, rows);
}

export function loadAdConfig(): AdConfig {
  const cfg = read<AdConfig>(AD_KEY, { client: "", slot: "" });
  return {
    client: typeof cfg?.client === "string" ? cfg.client : "",
    slot: typeof cfg?.slot === "string" ? cfg.slot : "",
  };
}

export function saveAdConfig(cfg: AdConfig) {
  write(AD_KEY, cfg);
}

export function loadSession(): SavedSession | null {
  const saved = read<SavedSession | null>(STATE_KEY, null);
  if (!saved?.state?.names || !Array.isArray(saved.state.balls) || saved.state.balls.length !== 9) {
    return null;
  }
  return {
    state: saved.state,
    history: Array.isArray(saved.history) ? saved.history : [],
    pendingNine: saved.pendingNine ?? null,
  };
}

export function saveSession(session: SavedSession | null) {
  if (!session) {
    localStorage.removeItem(STATE_KEY);
    return;
  }
  write(STATE_KEY, {
    state: session.state,
    history: session.history.slice(-60),
    pendingNine: session.pendingNine,
  });
}

export function nameKey(name: string) {
  return name.trim().toLowerCase();
}

export function toRecord(state: MatchState): MatchRecord | null {
  if (state.winner === null || !state.matchPts) return null;
  return {
    id: state.id,
    date: new Date().toISOString(),
    names: [...state.names],
    sls: [...state.sls],
    guests: [...state.guests],
    goals: [...state.goals],
    scores: [...state.scores],
    matchPts: [...state.matchPts],
    winner: state.winner,
    innings: state.innings,
    defenses: [...state.defenses],
    brs: [...state.brs],
    snaps: [...state.snaps],
    deadTotal: state.deadTotal,
    racks: state.rackNum,
    runs: [state.runs[0].slice(), state.runs[1].slice()],
    topRuns: topRuns(state)
      .filter((row) => !state.guests[row.p])
      .map((row) => ({ name: state.names[row.p], len: row.len })),
  };
}

export function isGuest(record: { guests?: boolean[] }, seat: number) {
  return Boolean(record.guests?.[seat]);
}

export type Career = {
  name: string;
  matches: number;
  wins: number;
  mp: number;
  pts: number;
  def: number;
  br: number;
  snap: number;
  bestRun: number;
};

export function careerStats(history: MatchRecord[]): Career[] {
  const map = new Map<string, Career>();
  for (const match of history) {
    for (const seat of [0, 1] as const) {
      if (isGuest(match, seat)) continue;
      const name = match.names[seat];
      const row = map.get(name) ?? {
        name,
        matches: 0,
        wins: 0,
        mp: 0,
        pts: 0,
        def: 0,
        br: 0,
        snap: 0,
        bestRun: 0,
      };
      row.matches += 1;
      if (match.winner === seat) row.wins += 1;
      row.mp += match.matchPts[seat];
      row.pts += match.scores[seat];
      row.def += match.defenses[seat];
      row.br += match.brs[seat];
      row.snap += match.snaps[seat];
      for (const len of match.runs[seat] ?? []) {
        if (len > row.bestRun) row.bestRun = len;
      }
      map.set(name, row);
    }
  }
  return [...map.values()].sort((a, b) => b.wins - a.wins || b.mp - a.mp);
}

export function recordFor(history: MatchRecord[], name: string) {
  const key = nameKey(name);
  let wins = 0;
  let losses = 0;
  for (const match of history) {
    for (const seat of [0, 1] as const) {
      if (isGuest(match, seat)) continue;
      if (nameKey(match.names[seat]) !== key) continue;
      if (match.winner === seat) wins += 1;
      else losses += 1;
    }
  }
  return `${wins}-${losses}`;
}

export function parseClient(raw: string): string | null {
  const value = raw.trim();
  if (/^ca-pub-\d{10,16}$/.test(value)) return value;
  if (/^\d{10,16}$/.test(value)) return `ca-pub-${value}`;
  return null;
}

export function parseSlot(raw: string): string | null {
  const value = raw.trim();
  if (!value) return "";
  if (/^\d{6,12}$/.test(value)) return value;
  return null;
}
