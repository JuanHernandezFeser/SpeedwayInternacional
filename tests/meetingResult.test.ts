import { describe, expect, it } from "bun:test";
import {
  computeIntermediate,
  computeMeetingResult,
  type RaceResultEntry,
} from "../src/shared/scoring";
import { makeProgramNumbers, makeRiders, strengthHeats } from "./fixtures";

const riders = makeRiders();
const programNumbers = makeProgramNumbers();
const intermediate = computeIntermediate({ riders, programNumbers, heats: strengthHeats() });

function lcqResult(
  order: [number, number, number, number],
  statuses: ("ok" | "R")[] = ["ok", "ok", "ok", "ok"],
): RaceResultEntry[] {
  return order.map((riderId, index) => ({
    riderId,
    gate: index + 1,
    finishPosition: index + 1,
    status: statuses[index] ?? "ok",
    points: 0,
  }));
}

// LCQ1 ranks 3/6/8/9 = P3/P5/P8/P9; LCQ2 ranks 4/5/7/10 = P4/P6/P7/P10.
const lcq1 = () => lcqResult([3, 5, 8, 9]);
const lcq2 = () => lcqResult([4, 6, 7, 10]);
// Final: the winners of both LCQs join P1 and P2.
const finalResult: RaceResultEntry[] = [1, 2, 4, 3].map((riderId, index) => ({
  riderId,
  gate: index + 1,
  finishPosition: index + 1,
  status: "ok" as const,
  points: 0,
}));

describe("meeting classification", () => {
  it("(h) assigns 5th to 10th from the LCQs, ordered by intermediate inside each pair", () => {
    const rows = computeMeetingResult({
      intermediate,
      lcq1: lcq1(),
      lcq2: lcq2(),
      final: finalResult,
    });
    const byRank = new Map(rows.map((r) => [r.rank, r.riderId]));
    // 2nds: P5 (inter 6, LCQ1) and P6 (inter 5, LCQ2) -> P6 is 5th, P5 is 6th.
    expect(byRank.get(5)).toBe(6);
    expect(byRank.get(6)).toBe(5);
    // 3rds: P8 (inter 8, LCQ1) and P7 (inter 7, LCQ2) -> P7 is 7th, P8 is 8th.
    expect(byRank.get(7)).toBe(7);
    expect(byRank.get(8)).toBe(8);
    // 4ths: P9 (inter 9, LCQ1) and P10 (inter 10, LCQ2) -> P9 is 9th, P10 is 10th.
    expect(byRank.get(9)).toBe(9);
    expect(byRank.get(10)).toBe(10);
  });

  it("(h/new point 5) if only one of a pair did not complete, that one takes the lower place", () => {
    // LCQ2 runner-up (P6) did not complete (status R) even though P6 was
    // better placed in the intermediate than P5: P6 must be 6th.
    const rows = computeMeetingResult({
      intermediate,
      lcq1: lcq1(),
      lcq2: lcqResult([4, 6, 7, 10], ["ok", "R", "ok", "ok"]),
      final: finalResult,
    });
    const byRank = new Map(rows.map((r) => [r.rank, r.riderId]));
    expect(byRank.get(5)).toBe(5);
    expect(byRank.get(6)).toBe(6);
  });

  it("(new point 5) if both of a pair did not complete, the intermediate order applies", () => {
    const rows = computeMeetingResult({
      intermediate,
      lcq1: lcqResult([3, 5, 8, 9], ["ok", "R", "ok", "ok"]),
      lcq2: lcqResult([4, 6, 7, 10], ["ok", "R", "ok", "ok"]),
      final: finalResult,
    });
    const byRank = new Map(rows.map((r) => [r.rank, r.riderId]));
    // P6 (inter 5) is still ahead of P5 (inter 6).
    expect(byRank.get(5)).toBe(6);
    expect(byRank.get(6)).toBe(5);
  });

  it("assigns 1st to 4th from the final and 11th to 18th from the intermediate", () => {
    const rows = computeMeetingResult({
      intermediate,
      lcq1: lcq1(),
      lcq2: lcq2(),
      final: finalResult,
    });
    const byRank = new Map(rows.map((r) => [r.rank, r.riderId]));
    expect(byRank.get(1)).toBe(1);
    expect(byRank.get(2)).toBe(2);
    expect(byRank.get(3)).toBe(4);
    expect(byRank.get(4)).toBe(3);
    // 11th to 18th by intermediate: P11, P12, P13, P16, P14, P15, R17, R18.
    expect([11, 12, 13, 14, 15, 16, 17, 18].map((r) => byRank.get(r))).toEqual([
      11, 12, 13, 16, 14, 15, 17, 18,
    ]);
  });

  it("assigns the championship points per place", () => {
    const rows = computeMeetingResult({
      intermediate,
      lcq1: lcq1(),
      lcq2: lcq2(),
      final: finalResult,
    });
    const byRank = new Map(rows.map((r) => [r.rank, r.championshipPoints]));
    expect(byRank.get(1)).toBe(20);
    expect(byRank.get(2)).toBe(18);
    expect(byRank.get(3)).toBe(16);
    expect(byRank.get(4)).toBe(14);
    expect(byRank.get(5)).toBe(12);
    expect(byRank.get(6)).toBe(11);
    expect(byRank.get(7)).toBe(10);
    expect(byRank.get(8)).toBe(9);
    expect(byRank.get(9)).toBe(8);
    expect(byRank.get(10)).toBe(7);
    expect(byRank.get(11)).toBe(6);
    expect(byRank.get(16)).toBe(1);
    expect(byRank.get(17)).toBe(0);
    expect(byRank.get(18)).toBe(0);
    expect(rows.length).toBe(18);
  });
});
