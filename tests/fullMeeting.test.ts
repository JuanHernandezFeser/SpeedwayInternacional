import { describe, expect, it } from "bun:test";
import {
  buildHeatsFromDraw,
  computeChampionship,
  computeHeatPoints,
  computeIntermediate,
  computeMeetingResult,
  computeStats,
  generateFinalRace,
  generateLcqs,
  type HeatWithResult,
  type RaceResultEntry,
} from "../src/shared/scoring";
import { makeDraw, makeProgramNumbers, makeRiders, strengthHeats } from "./fixtures";

const riders = makeRiders();
const programNumbers = makeProgramNumbers();

function lcqResult(order: [number, number, number, number]): RaceResultEntry[] {
  return order.map((riderId, index) => ({
    riderId,
    gate: index + 1,
    finishPosition: index + 1,
    status: "ok" as const,
    points: 0,
  }));
}

describe("(j) full example meeting, verifiable by hand", () => {
  // 1. Draw and heats generated automatically.
  const heats = buildHeatsFromDraw(makeDraw());
  expect(heats.length).toBe(20);

  // 2. Results: heat points per program number, hand-computed from the
  // starting table (see tests/fixtures.ts).
  const heatResults = strengthHeats();
  const intermediate = computeIntermediate({ riders, programNumbers, heats: heatResults });

  it("computes the hand-verified intermediate classification", () => {
    const expected: [number, number][] = [
      [1, 15],
      [2, 14],
      [3, 12],
      [4, 12],
      [6, 10],
      [5, 9],
      [7, 9],
      [8, 8],
      [9, 7],
      [10, 6],
      [11, 5],
      [12, 4],
      [13, 3],
      [16, 3],
      [14, 2],
      [15, 1],
      [17, 0],
      [18, 0],
    ];
    expect(intermediate.hasBlockedTies).toBe(false);
    expect(intermediate.rows.map((r) => [r.riderId, r.heatPoints])).toEqual(expected);
    expect(intermediate.rows.map((r) => r.rank)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
    ]);
  });

  it("generates the LCQs and the final from the intermediate", () => {
    const lcqs = generateLcqs(intermediate)!;
    expect(lcqs[0].entries.map((e) => e.riderId)).toEqual([3, 5, 8, 9]);
    expect(lcqs[1].entries.map((e) => e.riderId)).toEqual([4, 6, 7, 10]);

    const lcq1 = lcqResult([3, 5, 8, 9]);
    const lcq2 = lcqResult([4, 6, 7, 10]);
    const final = generateFinalRace(intermediate, lcq1, lcq2);
    expect(final.entries.map((e) => e.riderId)).toEqual([1, 2, 3, 4]);
    expect(final.entries.every((e) => e.gate === null)).toBe(true);
  });

  const lcq1 = lcqResult([3, 5, 8, 9]);
  const lcq2 = lcqResult([4, 6, 7, 10]);
  const final: RaceResultEntry[] = [1, 2, 4, 3].map((riderId, index) => ({
    riderId,
    gate: index + 1,
    finishPosition: index + 1,
    status: "ok" as const,
    points: 0,
  }));
  const meetingResult = computeMeetingResult({ intermediate, lcq1, lcq2, final });

  it("computes the hand-verified meeting classification and points", () => {
    const expected: [number, number, number][] = [
      [1, 1, 20],
      [2, 2, 18],
      [3, 4, 16],
      [4, 3, 14],
      [5, 6, 12],
      [6, 5, 11],
      [7, 7, 10],
      [8, 8, 9],
      [9, 9, 8],
      [10, 10, 7],
      [11, 11, 6],
      [12, 12, 5],
      [13, 13, 4],
      [14, 16, 3],
      [15, 14, 2],
      [16, 15, 1],
      [17, 17, 0],
      [18, 18, 0],
    ];
    expect(meetingResult.map((r) => [r.rank, r.riderId, r.championshipPoints])).toEqual(
      expected,
    );
  });

  it("computes the championship table from the meeting results", () => {
    const pointsPerRider = new Map<number, number[]>();
    for (const row of meetingResult) {
      pointsPerRider.set(row.riderId, [row.championshipPoints]);
    }
    const championship = computeChampionship({ riders, pointsPerRider });
    const byRank = championship.map((r) => [r.rank, r.riderId, r.totalPoints]);
    expect(byRank[0]).toEqual([1, 1, 20]);
    expect(byRank[1]).toEqual([2, 2, 18]);
    expect(byRank[2]).toEqual([3, 4, 16]);
    const last = championship.slice(-2);
    expect(last.map((r) => r.rank)).toEqual([17, 17]);
    expect(last.map((r) => r.tied)).toEqual([true, true]);
  });

  it("computes the per-rider statistics", () => {
    const heatEntries = heatResults.flatMap((h) => {
      const points = computeHeatPoints(h.entries);
      return h.entries.map((e) => ({
        riderId: e.riderId,
        points: points.get(e.riderId)!,
        finishPosition: e.finishPosition,
      }));
    });
    const finalAppearances = new Map(final.map((e) => [e.riderId, 1]));
    const stats = computeStats({
      heatEntries,
      meetingRanks: meetingResult.map((r) => ({ riderId: r.riderId, rank: r.rank })),
      finalAppearances,
    });
    const p1 = stats.find((s) => s.riderId === 1)!;
    expect(p1).toEqual({
      riderId: 1,
      meetingsDisputed: 1,
      bestMeetingResult: 1,
      heatsRaced: 5,
      heatWins: 5,
      pointsAvg: 3,
      finalAppearances: 1,
    });
    const reserve17 = stats.find((s) => s.riderId === 17)!;
    expect(reserve17.heatsRaced).toBe(0);
    expect(reserve17.meetingsDisputed).toBe(1);
    expect(reserve17.pointsAvg).toBe(0);
    const p6 = stats.find((s) => s.riderId === 6)!;
    expect(p6).toMatchObject({ heatsRaced: 5, heatWins: 0, pointsAvg: 2 });
  });

  it("(i) correcting a heat recomputes the intermediate and regenerates the LCQs", () => {
    // Correct heat 2 so P7 wins instead of P5.
    const corrected: HeatWithResult[] = strengthHeats().map((h) => {
      if (h.raceNumber !== 2) return h;
      const positions: Record<number, number> = { 7: 1, 5: 2, 6: 3, 8: 4 };
      return {
        raceNumber: 2,
        entries: h.entries.map((e) => ({
          ...e,
          finishPosition: positions[e.riderId]!,
        })),
      };
    });
    const recalculated = computeIntermediate({
      riders,
      programNumbers,
      heats: corrected,
    });
    expect(recalculated.hasBlockedTies).toBe(false);
    const before = generateLcqs(intermediate)!;
    const after = generateLcqs(recalculated)!;
    expect(before[0].entries.map((e) => e.riderId)).toEqual([3, 5, 8, 9]);
    expect(before[1].entries.map((e) => e.riderId)).toEqual([4, 6, 7, 10]);
    // P5 moves from LCQ1 to LCQ2 and P6 from LCQ2 to LCQ1.
    expect(after[0].entries.map((e) => e.riderId)).toEqual([3, 6, 8, 9]);
    expect(after[1].entries.map((e) => e.riderId)).toEqual([4, 7, 5, 10]);
    // Ranks: 1:P1, 2:P2, 3:P3, 4:P4, 5:P7, 6:P6, 7:P5, 8:P8.
    expect(recalculated.rows.slice(0, 8).map((r) => r.riderId)).toEqual([
      1, 2, 3, 4, 7, 6, 5, 8,
    ]);
  });
});
