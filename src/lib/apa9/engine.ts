export const GOALS: Record<number, number> = {
  1: 14,
  2: 19,
  3: 25,
  4: 31,
  5: 38,
  6: 46,
  7: 55,
  8: 65,
  9: 75,
};

/** Lower bound of the loser's points for 1..8 match points (official scoresheet). */
export const CHART: Record<number, number[]> = {
  1: [3, 4, 5, 7, 8, 9, 11, 12],
  2: [4, 6, 8, 9, 11, 13, 15, 17],
  3: [5, 7, 10, 12, 15, 17, 20, 22],
  4: [6, 9, 12, 15, 19, 22, 25, 28],
  5: [7, 11, 15, 19, 23, 27, 30, 34],
  6: [9, 13, 18, 23, 28, 32, 37, 41],
  7: [11, 16, 22, 27, 33, 38, 44, 50],
  8: [14, 20, 27, 33, 40, 46, 53, 59],
  9: [18, 25, 32, 39, 47, 54, 61, 68],
};

export const MATCH_POINT_HEADER = [
  "20-0",
  "19-1",
  "18-2",
  "17-3",
  "16-4",
  "15-5",
  "14-6",
  "13-7",
  "12-8",
] as const;

export const MATCH_POINT_ROWS: { sl: number; cells: string[] }[] = [
  { sl: 1, cells: ["<3", "3", "4", "5-6", "7", "8", "9-10", "11", "12-13"] },
  { sl: 2, cells: ["<4", "4-5", "6-7", "8", "9-10", "11-12", "13-14", "15-16", "17-18"] },
  { sl: 3, cells: ["<5", "5-6", "7-9", "10-11", "12-14", "15-16", "17-19", "20-21", "22-24"] },
  { sl: 4, cells: ["<6", "6-8", "9-11", "12-14", "15-18", "19-21", "22-24", "25-27", "28-30"] },
  { sl: 5, cells: ["<7", "7-10", "11-14", "15-18", "19-22", "23-26", "27-29", "30-33", "34-37"] },
  { sl: 6, cells: ["<9", "9-12", "13-17", "18-22", "23-27", "28-31", "32-36", "37-40", "41-45"] },
  { sl: 7, cells: ["<11", "11-15", "16-21", "22-26", "27-32", "33-37", "38-43", "44-49", "50-54"] },
  { sl: 8, cells: ["<14", "14-19", "20-26", "27-32", "33-39", "40-45", "46-52", "53-58", "59-64"] },
  { sl: 9, cells: ["<18", "18-24", "25-31", "32-38", "39-46", "47-53", "54-60", "61-67", "68-74"] },
];

export type Seat = 0 | 1;
export type BallMark = "table" | "dead" | "p0" | "p1";
export type LogPart = { text: string; strong?: boolean };

export type MatchState = {
  id: string;
  names: [string, string];
  sls: [number, number];
  guests: [boolean, boolean];
  goals: [number, number];
  scores: [number, number];
  defenses: [number, number];
  brs: [number, number];
  snaps: [number, number];
  deadTotal: number;
  innings: number;
  runs: [number[], number[]];
  currentRun: number;
  lagWinner: Seat;
  current: Seat;
  breaker: Seat;
  opponentShot: boolean;
  balls: BallMark[];
  rackNum: number;
  deadMode: boolean;
  winner: Seat | null;
  matchPts: [number, number] | null;
  startedAt: string;
  log: LogPart[][];
};

export type NineMode = "earlyOrSnap" | "snapOrBr";

export type NinePrompt = {
  p: Seat;
  won: boolean;
  mode: NineMode;
};

export type Session = {
  state: MatchState;
  undo: MatchState[];
  pendingNine: NinePrompt | null;
};

export function loserMatchPoints(sl: number, pts: number): number {
  const bounds = CHART[sl];
  if (!bounds) return 0;
  let n = 0;
  for (let i = 0; i < bounds.length; i++) if (pts >= bounds[i]!) n = i + 1;
  return n;
}

export function other(p: Seat): Seat {
  return p === 0 ? 1 : 0;
}

function freshBalls(): BallMark[] {
  return Array.from({ length: 9 }, () => "table" as BallMark);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function pushLog(state: MatchState, parts: LogPart[]) {
  state.log.unshift(parts);
  if (state.log.length > 120) state.log.pop();
}

function commit(session: Session, draft: MatchState, pending: NinePrompt | null): Session {
  const undo = session.undo.concat([clone(session.state)]);
  return {
    state: draft,
    undo: undo.length > 300 ? undo.slice(undo.length - 300) : undo,
    pendingNine: pending,
  };
}

function flushRun(state: MatchState, p: Seat) {
  if (state.currentRun > 0) {
    state.runs[p].push(state.currentRun);
    state.currentRun = 0;
  }
}

function endTurn(state: MatchState) {
  const p = state.current;
  const lagLoser = other(state.lagWinner);
  if (p === lagLoser) state.innings += 1;
  state.current = other(p);
}

function finalize(state: MatchState, w: Seat) {
  flushRun(state, w);
  const l = other(w);
  const lPts = loserMatchPoints(state.sls[l], state.scores[l]);
  const matchPts: [number, number] = [0, 0];
  matchPts[w] = 20 - lPts;
  matchPts[l] = lPts;
  state.matchPts = matchPts;
  state.winner = w;
  pushLog(state, [
    { text: state.names[w], strong: true },
    {
      text: ` reaches ${state.scores[w]} and wins ${matchPts[w]}–${matchPts[l]} in match points.`,
    },
  ]);
}

function finishRack(state: MatchState, rackWinner: Seat, matchWon: boolean) {
  if (matchWon) {
    finalize(state, rackWinner);
    return;
  }
  state.rackNum += 1;
  state.balls = freshBalls();
  state.breaker = rackWinner;
  state.current = rackWinner;
  state.opponentShot = false;
  pushLog(state, [
    { text: `Rack ${state.rackNum}: ` },
    { text: state.names[rackWinner], strong: true },
    { text: " breaks." },
  ]);
}

function markOpponent(state: MatchState, p: Seat) {
  if (p !== state.breaker) state.opponentShot = true;
}

export function createMatch(
  names: [string, string],
  sls: [number, number],
  lagWinner: Seat,
  guests: [boolean, boolean],
): Session {
  const lag: Seat = lagWinner === 1 ? 1 : 0;
  const state: MatchState = {
    id: crypto.randomUUID(),
    names,
    sls,
    guests,
    goals: [GOALS[sls[0]] ?? 31, GOALS[sls[1]] ?? 31],
    scores: [0, 0],
    defenses: [0, 0],
    brs: [0, 0],
    snaps: [0, 0],
    deadTotal: 0,
    innings: 0,
    runs: [[], []],
    currentRun: 0,
    lagWinner: lag,
    current: lag,
    breaker: lag,
    opponentShot: false,
    balls: freshBalls(),
    rackNum: 1,
    deadMode: false,
    winner: null,
    matchPts: null,
    startedAt: new Date().toISOString(),
    log: [],
  };
  const guestNote =
    guests[0] || guests[1]
      ? " Guests are left out of career stats."
      : "";
  pushLog(state, [
    {
      text: `${names[0]} (SL-${sls[0]}, to ${state.goals[0]}) vs ${names[1]} (SL-${sls[1]}, to ${state.goals[1]}). `,
    },
    { text: names[lag], strong: true },
    { text: ` won the lag and breaks.${guestNote}` },
  ]);
  return { state, undo: [], pendingNine: null };
}

export function pocket(session: Session, ball: number): Session {
  const state = session.state;
  if (state.winner !== null || session.pendingNine) return session;
  if (ball < 1 || ball > 9) return session;
  if (state.balls[ball - 1] !== "table") return session;

  if (state.deadMode) {
    if (ball === 9) {
      const draft = clone(state);
      pushLog(draft, [{ text: "The 9 is never dead. It spots after a foul." }]);
      return { ...session, state: draft };
    }
    const draft = clone(state);
    draft.balls[ball - 1] = "dead";
    draft.deadTotal += 1;
    pushLog(draft, [
      { text: `Ball ${ball} marked ` },
      { text: "dead", strong: true },
      { text: "." },
    ]);
    return commit(session, draft, null);
  }

  const draft = clone(state);
  const p = draft.current;
  markOpponent(draft, p);
  const pts = ball === 9 ? 2 : 1;
  draft.balls[ball - 1] = p === 0 ? "p0" : "p1";
  draft.scores[p] += pts;
  draft.currentRun += 1;
  pushLog(draft, [
    { text: draft.names[p], strong: true },
    { text: ` pockets the ${ball} (+${pts}). ${draft.scores[p]}/${draft.goals[p]}` },
  ]);
  const won = draft.scores[p] >= draft.goals[p];

  if (ball === 9) {
    let alreadyOff = 0;
    for (let i = 0; i < 8; i++) if (draft.balls[i] !== "table") alreadyOff += 1;
    let leftDead = 0;
    for (let j = 0; j < 8; j++) {
      if (draft.balls[j] === "table") {
        draft.balls[j] = "dead";
        leftDead += 1;
      }
    }
    if (leftDead) {
      draft.deadTotal += leftDead;
      pushLog(draft, [
        { text: `${leftDead} ball${leftDead === 1 ? "" : "s"} left on the table go dead.` },
      ]);
    }
    const cleanSweep = p === draft.breaker && !draft.opponentShot;
    if (alreadyOff === 0) {
      return commit(session, draft, { p, won, mode: "earlyOrSnap" });
    }
    if (cleanSweep) {
      return commit(session, draft, { p, won, mode: "snapOrBr" });
    }
    finishRack(draft, p, won);
    return commit(session, draft, null);
  }

  if (won) finalize(draft, p);
  return commit(session, draft, null);
}

export function resolveNine(session: Session, isSnap: boolean): Session {
  if (!session.pendingNine) return session;
  const ctx = session.pendingNine;
  const draft = clone(session.state);
  if (isSnap) {
    draft.snaps[ctx.p] += 1;
    pushLog(draft, [
      { text: draft.names[ctx.p], strong: true },
      { text: " — 9 on the snap." },
    ]);
  } else if (ctx.mode === "earlyOrSnap") {
    pushLog(draft, [
      { text: draft.names[ctx.p], strong: true },
      { text: " — 9 made early, not on the snap." },
    ]);
  } else {
    draft.brs[ctx.p] += 1;
    pushLog(draft, [
      { text: draft.names[ctx.p], strong: true },
      { text: " — break and run." },
    ]);
  }
  finishRack(draft, ctx.p, ctx.won);
  return { state: draft, undo: session.undo, pendingNine: null };
}

function turnOver(session: Session, kind: "miss" | "defense" | "foul"): Session {
  if (session.state.winner !== null || session.pendingNine) return session;
  const draft = clone(session.state);
  const p = draft.current;
  markOpponent(draft, p);
  draft.deadMode = false;
  flushRun(draft, p);
  if (kind === "miss") {
    pushLog(draft, [
      { text: draft.names[p], strong: true },
      { text: ` misses. ${draft.names[other(p)]} is up.` },
    ]);
  } else if (kind === "defense") {
    draft.defenses[p] += 1;
    pushLog(draft, [
      { text: draft.names[p], strong: true },
      { text: " plays a defensive shot. Turn over." },
    ]);
  } else {
    pushLog(draft, [
      { text: draft.names[p], strong: true },
      { text: ` fouls. ${draft.names[other(p)]} has ball in hand. Mark balls made on the foul as dead.` },
    ]);
  }
  endTurn(draft);
  return commit(session, draft, null);
}

export function miss(session: Session): Session {
  return turnOver(session, "miss");
}

export function defense(session: Session): Session {
  return turnOver(session, "defense");
}

export function foul(session: Session): Session {
  return turnOver(session, "foul");
}

export function toggleDead(session: Session): Session {
  if (session.state.winner !== null || session.pendingNine) return session;
  const draft = clone(session.state);
  draft.deadMode = !draft.deadMode;
  return { ...session, state: draft };
}

export function undo(session: Session): Session {
  if (!session.undo.length) {
    return session.pendingNine ? { ...session, pendingNine: null } : session;
  }
  const prev = session.undo[session.undo.length - 1]!;
  return {
    state: clone(prev),
    undo: session.undo.slice(0, -1),
    pendingNine: null,
  };
}

export type RunRow = { p: Seat; len: number; live?: boolean };

export function topRuns(state: MatchState): RunRow[] {
  const list: RunRow[] = [];
  for (const p of [0, 1] as const) {
    for (const len of state.runs[p]) list.push({ p, len });
  }
  if (state.currentRun > 0 && state.winner === null) {
    list.push({ p: state.current, len: state.currentRun, live: true });
  }
  list.sort((a, b) => b.len - a.len);
  return list.slice(0, 3);
}
