import { describe, expect, it } from "bun:test";
import {
  buildHeatsFromDraw,
  heatNumberForPrograms,
  heatsForProgram,
  HEAT_SCHEDULE,
  validateDraw,
} from "../src/shared/scoring";
import { makeDraw } from "./fixtures";

describe("heat schedule", () => {
  it("(a) has 20 heats with 4 distinct programs each and every program riding 5 times", () => {
    expect(HEAT_SCHEDULE.length).toBe(20);
    const counts = new Map<number, number>();
    for (const row of HEAT_SCHEDULE) {
      expect(row.length).toBe(4);
      expect(new Set(row).size).toBe(4);
      for (const p of row) counts.set(p, (counts.get(p) ?? 0) + 1);
    }
    expect([...counts.keys()].sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    ]);
    for (const c of counts.values()) expect(c).toBe(5);
  });

  it("(a) every program number appears in exactly 5 heats with the right gates", () => {
    for (let program = 1; program <= 16; program++) {
      const rides = heatsForProgram(program);
      expect(rides.length).toBe(5);
      for (const ride of rides) {
        expect(ride.gate).toBeGreaterThanOrEqual(1);
        expect(ride.gate).toBeLessThanOrEqual(4);
        expect(HEAT_SCHEDULE[ride.heat - 1]![ride.gate - 1]).toBe(program);
      }
    }
  });

  it("(a) control example: program 5 rides heats 2, 5, 10, 15 and 20 from gates 1, 3, 2, 4 and 1", () => {
    expect(heatsForProgram(5)).toEqual([
      { heat: 2, gate: 1 },
      { heat: 5, gate: 3 },
      { heat: 10, gate: 2 },
      { heat: 15, gate: 4 },
      { heat: 20, gate: 1 },
    ]);
  });

  it("(a) every pair of programs shares exactly one heat", () => {
    for (let a = 1; a <= 16; a++) {
      for (let b = a + 1; b <= 16; b++) {
        const heatNumber = heatNumberForPrograms(a, b);
        expect(heatNumber).toBeGreaterThanOrEqual(1);
        expect(heatNumber).toBeLessThanOrEqual(20);
        const row = HEAT_SCHEDULE[heatNumber - 1]!;
        expect(row.includes(a)).toBe(true);
        expect(row.includes(b)).toBe(true);
        // and only that heat
        const shared = heatsForProgram(a).filter((r) =>
          heatsForProgram(b).some((s) => s.heat === r.heat),
        );
        expect(shared.length).toBe(1);
      }
    }
  });

  it("(a) builds the 20 heats from a draw with gates", () => {
    const heats = buildHeatsFromDraw(makeDraw());
    expect(heats.length).toBe(20);
    const first = heats[0]!;
    expect(first.raceNumber).toBe(1);
    expect(first.entries.map((e) => e.gate)).toEqual([1, 2, 3, 4]);
    expect(first.entries.map((e) => e.riderId)).toEqual([1, 2, 3, 4]);
    const heat5 = heats[4]!;
    expect(heat5.entries.map((e) => e.riderId)).toEqual([13, 1, 5, 9]);
  });

  it("rejects invalid draws", () => {
    expect(validateDraw(makeDraw()).ok).toBe(true);
    expect(
      validateDraw({ titulares: makeDraw().titulares.slice(0, 15), reserves: [17, 18] }).ok,
    ).toBe(false);
    const repeated = {
      titulares: makeDraw().titulares.slice(),
      reserves: makeDraw().reserves.slice(),
    };
    repeated.titulares[1] = { riderId: 2, programNumber: 1 };
    expect(validateDraw(repeated).ok).toBe(false);
    const reserveAsTitular = makeDraw();
    reserveAsTitular.reserves = [1, 2];
    expect(validateDraw(reserveAsTitular).ok).toBe(false);
  });
});
