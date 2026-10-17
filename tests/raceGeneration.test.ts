import { describe, expect, it } from "bun:test";
import {
  computeIntermediate,
  generateFinalRace,
  generateLcqs,
  type RaceResultEntry,
} from "../src/shared/scoring";
import { makeProgramNumbers, makeRiders, strengthHeats } from "./fixtures";

const riders = makeRiders();
const programNumbers = makeProgramNumbers();
const intermediate = computeIntermediate({ riders, programNumbers, heats: strengthHeats() });

function lcqResult(
  first: number,
  second: number,
  third: number,
  fourth: number,
): RaceResultEntry[] {
  return [first, second, third, fourth].map((riderId, index) => ({
    riderId,
    gate: index + 1,
    finishPosition: index + 1,
    status: "ok" as const,
    points: 0,
  }));
}

describe("LCQ and final generation", () => {
  it("(f) LCQ1 takes the intermediate 3rd, 6th, 8th and 9th and LCQ2 the 4th, 5th, 7th and 10th", () => {
    // Hand-computed intermediate: 1:P1, 2:P2, 3:P3, 4:P4, 5:P6, 6:P5,
    // 7:P7, 8:P8, 9:P9, 10:P10.
    const lcqs = generateLcqs(intermediate)!;
    expect(lcqs).not.toBeNull();
    const [lcq1, lcq2] = lcqs;
    expect(lcq1.raceNumber).toBe(21);
    expect(lcq1.kind).toBe("lcq1");
    // Intermediate ranks 3, 6, 8 and 9 -> riders P3, P5, P8, P9.
    expect(lcq1.entries).toEqual([
      { riderId: 3, gate: 1 },
      { riderId: 5, gate: 2 },
      { riderId: 8, gate: 3 },
      { riderId: 9, gate: 4 },
    ]);
    expect(lcq2.raceNumber).toBe(22);
    expect(lcq2.kind).toBe("lcq2");
    // Intermediate ranks 4, 5, 7 and 10 -> riders P4, P6, P7, P10.
    expect(lcq2.entries).toEqual([
      { riderId: 4, gate: 1 },
      { riderId: 6, gate: 2 },
      { riderId: 7, gate: 3 },
      { riderId: 10, gate: 4 },
    ]);
  });

  it("(g) the final is created with the 4 qualified riders and no gates", () => {
    const lcq1 = lcqResult(3, 5, 8, 9);
    const lcq2 = lcqResult(4, 6, 7, 10);
    const final = generateFinalRace(intermediate, lcq1, lcq2);
    expect(final.raceNumber).toBe(23);
    expect(final.kind).toBe("final");
    expect(final.entries.length).toBe(4);
    // Election order: the two best of the intermediate first, then the LCQ
    // winners ordered by their intermediate position.
    expect(final.entries.map((e) => e.riderId)).toEqual([1, 2, 3, 4]);
    for (const entry of final.entries) expect(entry.gate).toBeNull();
  });
});
