import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createMatch,
  defense,
  foul,
  loserMatchPoints,
  miss,
  pocket,
  resolveNine,
  undo,
} from "./engine.ts";

describe("APA 9-ball match points", () => {
  it("uses the scoresheet bounds", () => {
    assert.equal(loserMatchPoints(1, 2), 0);
    assert.equal(loserMatchPoints(1, 3), 1);
    assert.equal(loserMatchPoints(1, 6), 3);
    assert.equal(loserMatchPoints(1, 13), 8);
    assert.equal(loserMatchPoints(4, 30), 8);
    assert.equal(loserMatchPoints(5, 6), 0);
    assert.equal(loserMatchPoints(5, 7), 1);
    assert.equal(loserMatchPoints(9, 17), 0);
    assert.equal(loserMatchPoints(9, 74), 8);
  });
});

describe("rack scoring", () => {
  it("scores 1–8 as one and the 9 as two", () => {
    let session = createMatch(["Alex", "Jordan"], [4, 4], 0, [false, false]);
    session = pocket(session, 5);
    assert.equal(session.state.scores[0], 1);
    assert.equal(session.state.currentRun, 1);
    assert.equal(session.state.current, 0);
  });

  it("asks snap vs early when the 9 is the first ball marked", () => {
    let session = createMatch(["Alex", "Jordan"], [4, 4], 0, [false, false]);
    session = pocket(session, 9);
    assert.equal(session.pendingNine?.mode, "earlyOrSnap");
    assert.equal(session.state.scores[0], 2);
    assert.equal(session.state.deadTotal, 8);
    session = resolveNine(session, true);
    assert.equal(session.state.snaps[0], 1);
    assert.equal(session.state.brs[0], 0);
    assert.equal(session.state.rackNum, 2);
    assert.equal(session.state.breaker, 0);
    assert.equal(session.pendingNine, null);
  });

  it("asks snap vs break-and-run on a clean sweep", () => {
    let session = createMatch(["Alex", "Jordan"], [4, 4], 0, [false, false]);
    for (const ball of [1, 2, 3, 4, 5, 6, 7, 8]) session = pocket(session, ball);
    session = pocket(session, 9);
    assert.equal(session.pendingNine?.mode, "snapOrBr");
    session = resolveNine(session, false);
    assert.equal(session.state.brs[0], 1);
    assert.equal(session.state.snaps[0], 0);
    assert.equal(session.state.scores[0], 10);
  });

  it("ends the rack with no tag after the opponent has been at the table", () => {
    let session = createMatch(["Alex", "Jordan"], [4, 4], 0, [false, false]);
    session = pocket(session, 1);
    session = miss(session);
    session = pocket(session, 9);
    assert.equal(session.pendingNine, null);
    assert.equal(session.state.rackNum, 2);
    assert.equal(session.state.breaker, 1);
    assert.equal(session.state.scores[1], 2);
    assert.equal(session.state.snaps[1], 0);
    assert.equal(session.state.brs[1], 0);
  });

  it("counts an inning when the lag loser ends a turn", () => {
    let session = createMatch(["Alex", "Jordan"], [4, 4], 0, [false, false]);
    session = miss(session);
    assert.equal(session.state.innings, 0);
    assert.equal(session.state.current, 1);
    session = defense(session);
    assert.equal(session.state.innings, 1);
    assert.equal(session.state.defenses[1], 1);
  });

  it("refuses to mark the 9 dead and scores a dead ball as zero", () => {
    let session = createMatch(["Alex", "Jordan"], [4, 4], 0, [false, false]);
    session = foul(session);
    session = { ...session, state: { ...session.state, deadMode: true } };
    const before = session.state.scores[1];
    session = pocket(session, 9);
    assert.equal(session.state.balls[8], "table");
    assert.equal(session.state.scores[1], before);
    session = pocket(session, 3);
    assert.equal(session.state.balls[2], "dead");
    assert.equal(session.state.deadTotal, 1);
    assert.equal(session.state.scores[1], before);
  });

  it("wins at the skill-level goal and splits 20 match points", () => {
    let session = createMatch(["Alex", "Jordan"], [1, 1], 0, [false, false]);
    for (const ball of [1, 2, 3, 4, 5, 6, 7, 8]) session = pocket(session, ball);
    session = pocket(session, 9);
    session = resolveNine(session, false);
    assert.equal(session.state.winner, null);
    assert.equal(session.state.scores[0], 10);
    for (const ball of [1, 2, 3, 4]) session = pocket(session, ball);
    assert.equal(session.state.winner, 0);
    assert.equal(session.state.scores[0], 14);
    assert.deepEqual(session.state.matchPts, [20, 0]);
  });

  it("undoes the last pocket, including an open 9 prompt", () => {
    let session = createMatch(["Alex", "Jordan"], [4, 4], 0, [false, false]);
    session = pocket(session, 1);
    session = pocket(session, 9);
    assert.ok(session.pendingNine);
    session = undo(session);
    assert.equal(session.pendingNine, null);
    assert.equal(session.state.scores[0], 1);
    assert.equal(session.state.balls[8], "table");
  });
});
