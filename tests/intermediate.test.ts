import { describe, expect, it } from "bun:test";
import { computeIntermediate, generateLcqs } from "../src/shared/scoring";
import { heat, makeProgramNumbers, makeRiders, strengthHeats } from "./fixtures";

const riders = makeRiders();
const programNumbers = makeProgramNumbers();

describe("intermediate classification", () => {
  it("(c) a reserve replacing a titulaire scores for himself", () => {
    // Reserve 17 replaces titulaire 2 on the same gate of heat 1 and wins.
    const heats = [
      heat(1, [
        { riderId: 1, gate: 1, finishPosition: 2 },
        { riderId: 17, gate: 2, finishPosition: 1, replacedRiderId: 2 },
        { riderId: 3, gate: 3, finishPosition: 3 },
        { riderId: 4, gate: 4, finishPosition: 4 },
      ]),
    ];
    const result = computeIntermediate({ riders, programNumbers, heats });
    const reserve = result.rows.find((r) => r.riderId === 17)!;
    const replaced = result.rows.find((r) => r.riderId === 2)!;
    expect(reserve.heatPoints).toBe(3);
    expect(replaced.heatPoints).toBe(0);
    expect(result.rows[0]!.riderId).toBe(17);
  });

  it("(d) breaks a tie with the direct result in the shared heat", () => {
    // Riders 1 and 2 end with 5 points each; they shared heat 1 where
    // rider 2 finished ahead of rider 1.
    const heats = [
      heat(1, [
        { riderId: 1, gate: 1, finishPosition: 2 },
        { riderId: 2, gate: 2, finishPosition: 1 },
        { riderId: 3, gate: 3, finishPosition: 3 },
        { riderId: 4, gate: 4, finishPosition: 4 },
      ]),
      heat(2, [
        { riderId: 1, gate: 1, finishPosition: 1 },
        { riderId: 2, gate: 2, finishPosition: 2 },
        { riderId: 5, gate: 3, finishPosition: 3 },
        { riderId: 6, gate: 4, finishPosition: 4 },
      ]),
    ];
    const result = computeIntermediate({ riders, programNumbers, heats });
    expect(result.rows[0]!.riderId).toBe(2);
    expect(result.rows[1]!.riderId).toBe(1);
    expect(result.rows[0]!.heatPoints).toBe(5);
    expect(result.rows[1]!.heatPoints).toBe(5);
    expect(result.rows[0]!.requiresManualResolution).toBe(false);
    expect(result.rows[1]!.requiresManualResolution).toBe(false);
  });

  it("(d) the rider who rode the shared heat wins when the other was replaced", () => {
    // Riders 1 and 2 tie on 2 points. They shared heat 1, but rider 1 was
    // replaced by reserve 17, so rider 2 wins the tie-break.
    const heats = [
      heat(1, [
        { riderId: 17, gate: 1, finishPosition: 1, replacedRiderId: 1 },
        { riderId: 2, gate: 2, finishPosition: 2 },
        { riderId: 3, gate: 3, finishPosition: 3 },
        { riderId: 4, gate: 4, finishPosition: 4 },
      ]),
      heat(2, [
        { riderId: 1, gate: 1, finishPosition: 2 },
        { riderId: 5, gate: 2, finishPosition: 1 },
        { riderId: 6, gate: 3, finishPosition: 3 },
        { riderId: 7, gate: 4, finishPosition: 4 },
      ]),
    ];
    const result = computeIntermediate({ riders, programNumbers, heats });
    const rank1 = result.rows.find((r) => r.riderId === 1)!;
    const rank2 = result.rows.find((r) => r.riderId === 2)!;
    expect(rank2.rank).toBeLessThan(rank1.rank);
    expect(rank2.requiresManualResolution).toBe(false);
    expect(rank1.requiresManualResolution).toBe(false);
  });

  it("(e) a tie of 3 or more riders requires manual resolution and blocks the LCQs", () => {
    const heats = [
      heat(1, [
        { riderId: 1, gate: 1, finishPosition: 1 },
        { riderId: 2, gate: 2, finishPosition: 2 },
        { riderId: 3, gate: 3, finishPosition: 3 },
        { riderId: 4, gate: 4, finishPosition: 4 },
      ]),
      heat(2, [
        { riderId: 5, gate: 1, finishPosition: 1 },
        { riderId: 6, gate: 2, finishPosition: 2 },
        { riderId: 7, gate: 3, finishPosition: 3 },
        { riderId: 8, gate: 4, finishPosition: 4 },
      ]),
      heat(3, [
        { riderId: 9, gate: 1, finishPosition: 1 },
        { riderId: 10, gate: 2, finishPosition: 2 },
        { riderId: 11, gate: 3, finishPosition: 3 },
        { riderId: 12, gate: 4, finishPosition: 4 },
      ]),
    ];
    const result = computeIntermediate({ riders, programNumbers, heats });
    expect(result.hasBlockedTies).toBe(true);
    expect(result.blockedGroups).toContainEqual([1, 5, 9]);
    const group = result.rows.filter((r) => [1, 5, 9].includes(r.riderId));
    for (const row of group) expect(row.requiresManualResolution).toBe(true);
    expect(generateLcqs(result)).toBeNull();
  });

  it("(e) a tie without criterion (neither rode the shared heat) requires manual resolution", () => {
    // Riders 1 and 2 shared heat 1 by the table, but both were replaced.
    const heats = [
      heat(1, [
        { riderId: 17, gate: 1, finishPosition: 1, replacedRiderId: 1 },
        { riderId: 18, gate: 2, finishPosition: 2, replacedRiderId: 2 },
        { riderId: 3, gate: 3, finishPosition: 3 },
        { riderId: 4, gate: 4, finishPosition: 4 },
      ]),
      heat(2, [
        { riderId: 1, gate: 1, finishPosition: 1 },
        { riderId: 5, gate: 2, finishPosition: 2 },
        { riderId: 6, gate: 3, finishPosition: 3 },
        { riderId: 7, gate: 4, finishPosition: 4 },
      ]),
      heat(3, [
        { riderId: 2, gate: 1, finishPosition: 1 },
        { riderId: 8, gate: 2, finishPosition: 2 },
        { riderId: 9, gate: 3, finishPosition: 3 },
        { riderId: 10, gate: 4, finishPosition: 4 },
      ]),
    ];
    const result = computeIntermediate({ riders, programNumbers, heats });
    expect(result.hasBlockedTies).toBe(true);
    expect(result.blockedGroups.some((g) => g.includes(1) && g.includes(2))).toBe(true);
    expect(generateLcqs(result)).toBeNull();
  });

  it("(e) a tie without criterion but with no consequence does not block", () => {
    // A big bottom tie (15 riders on 0 points spanning ranks 4-18) DOES
    // block: the order changes the meeting points (6 down to 1 points).
    const heats = [
      heat(1, [
        { riderId: 1, gate: 1, finishPosition: 1 },
        { riderId: 2, gate: 2, finishPosition: 2 },
        { riderId: 3, gate: 3, finishPosition: 3 },
        { riderId: 4, gate: 4, finishPosition: 4 },
      ]),
    ];
    const blocked = computeIntermediate({ riders, programNumbers, heats });
    expect(blocked.hasBlockedTies).toBe(true);
    expect(generateLcqs(blocked)).toBeNull();

    // But a tie that only occupies ranks 17-18 (the two reserves on 0
    // points, no shared heat) does NOT block and is ordered by permanent
    // number.
    const result = computeIntermediate({
      riders: makeRiders({ 17: 900, 18: 901 }),
      programNumbers,
      heats: strengthHeats(),
    });
    expect(result.hasBlockedTies).toBe(false);
    const last = result.rows.slice(-2);
    expect(last.map((r) => r.riderId)).toEqual([17, 18]);
    expect(generateLcqs(result)).not.toBeNull();
  });

  it("(new point 1) applies the manual order once the administrator resolves the tie", () => {
    // Rider 1 and reserve 17 tie on 5 points. The reserve has no program
    // number, so there is no direct criterion: the tie must be resolved by
    // the administrator.
    const smallRiders = makeRiders().slice(0, 1).concat(makeRiders().slice(16, 17));
    const smallPrograms = new Map([[1, 1]]);
    const heats = [
      heat(1, [
        { riderId: 1, gate: 1, finishPosition: 1 },
        { riderId: 17, gate: 2, finishPosition: 2 },
      ]),
      heat(2, [
        { riderId: 17, gate: 1, finishPosition: 1 },
        { riderId: 1, gate: 2, finishPosition: 2 },
      ]),
    ];
    const blocked = computeIntermediate({
      riders: smallRiders,
      programNumbers: smallPrograms,
      heats,
    });
    expect(blocked.hasBlockedTies).toBe(true);
    expect(blocked.blockedGroups).toEqual([[1, 17]]);
    expect(generateLcqs(blocked)).toBeNull();

    const resolved = computeIntermediate({
      riders: smallRiders,
      programNumbers: smallPrograms,
      heats,
      manualOrders: [[17, 1]],
    });
    expect(resolved.hasBlockedTies).toBe(false);
    expect(resolved.rows.map((r) => r.riderId)).toEqual([17, 1]);
    expect(resolved.rows[0]!.manualOrder).toBe(0);
    expect(resolved.rows[1]!.manualOrder).toBe(1);
    expect(resolved.rows[1]!.requiresManualResolution).toBe(false);
  });

  it("keeps the manual order when the heats are reprocessed", () => {
    const heats = strengthHeats();
    const first = computeIntermediate({
      riders,
      programNumbers,
      heats,
      manualOrders: [[18, 17]],
    });
    const again = computeIntermediate({
      riders,
      programNumbers,
      heats: heats.map((h) => ({ ...h, entries: h.entries.map((e) => ({ ...e })) })),
      manualOrders: [[18, 17]],
    });
    expect(first.rows.slice(-2).map((r) => r.riderId)).toEqual([18, 17]);
    expect(again.rows.slice(-2).map((r) => r.riderId)).toEqual([18, 17]);
  });

  it("(new point 1) blocks a tie that spans the 16th and 17th places (1 point vs 0)", () => {
    // Extra heat gives reserve 17 exactly 1 point, so it ties with P15 (1
    // point) at ranks 16-17: 16th is worth 1 championship point, 17th is
    // worth 0, so the order changes a result and the tie must block.
    const extra = heat(21, [
      { riderId: 1, gate: 1, finishPosition: 1 },
      { riderId: 2, gate: 2, finishPosition: 2 },
      { riderId: 17, gate: 3, finishPosition: 3 },
      { riderId: 3, gate: 4, finishPosition: 4 },
    ]);
    const result = computeIntermediate({
      riders,
      programNumbers,
      heats: [...strengthHeats(), extra],
    });
    const p15 = result.rows.find((r) => r.riderId === 15)!;
    const r17 = result.rows.find((r) => r.riderId === 17)!;
    expect(p15.heatPoints).toBe(1);
    expect(r17.heatPoints).toBe(1);
    expect(p15.rank).toBe(16);
    expect(r17.rank).toBe(17);
    expect(result.rows.find((r) => r.riderId === 18)!.rank).toBe(18);
    expect(result.hasBlockedTies).toBe(true);
    expect(result.blockedGroups).toContainEqual([15, 17]);
    expect(p15.requiresManualResolution).toBe(true);
    expect(r17.requiresManualResolution).toBe(true);
    expect(generateLcqs(result)).toBeNull();
  });

  it("(new point 1) does not block a tie between the 17th and 18th places (both 0)", () => {
    const result = computeIntermediate({ riders, programNumbers, heats: strengthHeats() });
    const r17 = result.rows.find((r) => r.riderId === 17)!;
    const r18 = result.rows.find((r) => r.riderId === 18)!;
    expect(r17.heatPoints).toBe(0);
    expect(r18.heatPoints).toBe(0);
    expect(r17.rank).toBe(17);
    expect(r18.rank).toBe(18);
    expect(r17.requiresManualResolution).toBe(false);
    expect(r18.requiresManualResolution).toBe(false);
    expect(result.hasBlockedTies).toBe(false);
    expect(generateLcqs(result)).not.toBeNull();
  });

  it("(new point 1) blocks a tie that affects the top two", () => {
    const four = makeRiders().slice(0, 4);
    const programs = new Map([
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
    ]);
    // Riders 1 and 2 dead-heat for first in their shared heat: they end up
    // tied and there is no direct criterion.
    const result = computeIntermediate({
      riders: four,
      programNumbers: programs,
      heats: [
        heat(1, [
          { riderId: 1, gate: 1, finishPosition: 1 },
          { riderId: 2, gate: 2, finishPosition: 1 },
          { riderId: 3, gate: 3, finishPosition: 3 },
          { riderId: 4, gate: 4, finishPosition: 4 },
        ]),
      ],
    });
    expect(result.rows[0]!.heatPoints).toBe(2.5);
    expect(result.rows[1]!.heatPoints).toBe(2.5);
    expect(result.blockedGroups).toContainEqual([1, 2]);
    expect(result.rows[0]!.requiresManualResolution).toBe(true);
    expect(result.rows[1]!.requiresManualResolution).toBe(true);
    expect(generateLcqs(result)).toBeNull();
  });

  it("(new point 1) blocks a tie inside the 3rd-10th band", () => {
    const four = makeRiders().slice(0, 4);
    const programs = new Map([
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
    ]);
    // Riders 3 and 4 dead-heat for third in their shared heat and end tied
    // with no direct criterion, occupying ranks 3-4.
    const result = computeIntermediate({
      riders: four,
      programNumbers: programs,
      heats: [
        heat(1, [
          { riderId: 1, gate: 1, finishPosition: 1 },
          { riderId: 2, gate: 2, finishPosition: 2 },
          { riderId: 3, gate: 3, finishPosition: 3 },
          { riderId: 4, gate: 4, finishPosition: 3 },
        ]),
      ],
    });
    const r3 = result.rows.find((r) => r.riderId === 3)!;
    const r4 = result.rows.find((r) => r.riderId === 4)!;
    expect(r3.heatPoints).toBe(0.5);
    expect(r3.rank).toBe(3);
    expect(r4.rank).toBe(4);
    expect(r3.requiresManualResolution).toBe(true);
    expect(result.blockedGroups).toContainEqual([3, 4]);
    expect(generateLcqs(result)).toBeNull();
  });
});
