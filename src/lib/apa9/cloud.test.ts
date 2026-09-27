import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatSyncCode, mergeHistory, mergeProfiles } from "./cloud.ts";
import type { MatchRecord, Profile } from "./storage.ts";

function match(partial: Partial<MatchRecord> & Pick<MatchRecord, "id" | "date">): MatchRecord {
  return {
    names: ["Alex", "Jordan"],
    sls: [4, 4],
    guests: [false, false],
    goals: [31, 31],
    scores: [31, 10],
    matchPts: [18, 2],
    winner: 0,
    innings: 4,
    defenses: [0, 1],
    brs: [0, 0],
    snaps: [0, 0],
    deadTotal: 0,
    racks: 4,
    runs: [[], []],
    topRuns: [],
    ...partial,
  };
}

describe("shared scorebook merge", () => {
  it("unions matches and keeps the newer copy of the same id", () => {
    const older = match({ id: "a", date: "2026-01-01T00:00:00.000Z", scores: [31, 4] });
    const newer = match({ id: "a", date: "2026-02-01T00:00:00.000Z", scores: [31, 12] });
    const onlyRemote = match({ id: "b", date: "2026-01-15T00:00:00.000Z" });
    const merged = mergeHistory([older, onlyRemote], [newer]);
    assert.equal(merged.length, 2);
    assert.equal(merged[0]?.id, "a");
    assert.deepEqual(merged[0]?.scores, [31, 12]);
    assert.equal(merged[1]?.id, "b");
  });

  it("keeps a local match the server has not seen", () => {
    const local = match({ id: "local", date: "2026-03-01T00:00:00.000Z" });
    const merged = mergeHistory([], [local]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.id, "local");
  });

  it("prefers the profile that was played more recently", () => {
    const server: Profile[] = [{ name: "Alex", sl: 3, created: "2026-01-01", lastPlayed: "2026-01-02" }];
    const client: Profile[] = [{ name: "Alex", sl: 5, created: "2026-01-01", lastPlayed: "2026-04-01" }];
    const merged = mergeProfiles(server, client);
    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.sl, 5);
  });

  it("formats an 8-character scorebook code", () => {
    assert.equal(formatSyncCode(" abcd1234 "), "ABCD-1234");
    assert.equal(formatSyncCode("ABCD-1234"), "ABCD-1234");
    assert.equal(formatSyncCode("ABC"), null);
  });
});
