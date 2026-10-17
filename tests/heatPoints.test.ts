import { describe, expect, it } from "bun:test";
import { computeHeatPoints, isValidRaceOrder } from "../src/shared/scoring";

describe("heat points", () => {
  it("awards 3/2/1/0 by finishing position", () => {
    const points = computeHeatPoints([
      { riderId: 1, gate: 1, finishPosition: 1, status: "ok" },
      { riderId: 2, gate: 2, finishPosition: 2, status: "ok" },
      { riderId: 3, gate: 3, finishPosition: 3, status: "ok" },
      { riderId: 4, gate: 4, finishPosition: 4, status: "ok" },
    ]);
    expect(points.get(1)).toBe(3);
    expect(points.get(2)).toBe(2);
    expect(points.get(3)).toBe(1);
    expect(points.get(4)).toBe(0);
  });

  it("(b) splits the points of the positions involved on a dead heat", () => {
    // Dead heat for first: (3+2)/2 = 2.5 each
    const forFirst = computeHeatPoints([
      { riderId: 1, gate: 1, finishPosition: 1, status: "ok" },
      { riderId: 2, gate: 2, finishPosition: 1, status: "ok" },
      { riderId: 3, gate: 3, finishPosition: 3, status: "ok" },
      { riderId: 4, gate: 4, finishPosition: 4, status: "ok" },
    ]);
    expect(forFirst.get(1)).toBe(2.5);
    expect(forFirst.get(2)).toBe(2.5);
    expect(forFirst.get(3)).toBe(1);
    expect(forFirst.get(4)).toBe(0);

    // Dead heat for third: (1+0)/2 = 0.5 each
    const forThird = computeHeatPoints([
      { riderId: 1, gate: 1, finishPosition: 1, status: "ok" },
      { riderId: 2, gate: 2, finishPosition: 2, status: "ok" },
      { riderId: 3, gate: 3, finishPosition: 3, status: "ok" },
      { riderId: 4, gate: 4, finishPosition: 3, status: "ok" },
    ]);
    expect(forThird.get(1)).toBe(3);
    expect(forThird.get(2)).toBe(2);
    expect(forThird.get(3)).toBe(0.5);
    expect(forThird.get(4)).toBe(0.5);
  });

  it("gives no points to M, R, F, T, d and N statuses", () => {
    for (const status of ["M", "R", "F", "T", "d", "N"] as const) {
      const points = computeHeatPoints([
        { riderId: 1, gate: 1, finishPosition: 1, status },
        { riderId: 2, gate: 2, finishPosition: 2, status: "ok" },
        { riderId: 3, gate: 3, finishPosition: 3, status: "ok" },
        { riderId: 4, gate: 4, finishPosition: 4, status: "ok" },
      ]);
      expect(points.get(1)).toBe(0);
      expect(points.get(2)).toBe(2);
      expect(points.get(3)).toBe(1);
      expect(points.get(4)).toBe(0);
    }
  });

  it("(new point 4) shares the dead-heat points first and then zeroes the non-scoring rider", () => {
    // Tie for first where one of the tied riders retired: the share is
    // (3+2)/2 = 2.5 for both, then the retired rider is zeroed without
    // redistributing anything.
    const points = computeHeatPoints([
      { riderId: 1, gate: 1, finishPosition: 1, status: "ok" },
      { riderId: 2, gate: 2, finishPosition: 1, status: "R" },
      { riderId: 3, gate: 3, finishPosition: 3, status: "ok" },
      { riderId: 4, gate: 4, finishPosition: 4, status: "ok" },
    ]);
    expect(points.get(1)).toBe(2.5);
    expect(points.get(2)).toBe(0);
    expect(points.get(3)).toBe(1);
    expect(points.get(4)).toBe(0);
  });

  it("validates finishing orders", () => {
    expect(isValidRaceOrder([1, 2, 3, 4])).toBe(true);
    expect(isValidRaceOrder([1, 1, 3, 4])).toBe(true);
    expect(isValidRaceOrder([2, 3, 4, 1])).toBe(true); // same multiset, any array order
    expect(isValidRaceOrder([1, 2, 3, 3])).toBe(true);
    expect(isValidRaceOrder([1, 1, 1, 4])).toBe(true);
    expect(isValidRaceOrder([1, 1, 3, 3])).toBe(true);
    expect(isValidRaceOrder([2, 2, 3, 4])).toBe(false);
    expect(isValidRaceOrder([1, 2, 2, 3])).toBe(false);
    expect(isValidRaceOrder([1, 1, 2, 4])).toBe(false);
    expect(isValidRaceOrder([4, 4, 4, 4])).toBe(false);
    expect(isValidRaceOrder([1, 2, 3])).toBe(false);
  });
});
