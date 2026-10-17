import type { DrawEntry, GeneratedRace } from "./types";

/**
 * Starting gate positions for heats 1-20, in program-number order
 * (gate 1, gate 2, gate 3, gate 4).
 */
export const HEAT_SCHEDULE: readonly (readonly [number, number, number, number])[] = [
  [1, 2, 3, 4],
  [5, 7, 6, 8],
  [10, 11, 9, 12],
  [15, 14, 16, 13],
  [13, 1, 5, 9],
  [14, 10, 2, 6],
  [11, 15, 7, 3],
  [4, 8, 12, 16],
  [6, 16, 1, 11],
  [12, 5, 15, 2],
  [8, 9, 3, 14],
  [13, 4, 10, 7],
  [7, 12, 14, 1],
  [2, 13, 8, 11],
  [16, 3, 10, 5],
  [9, 6, 4, 15],
  [1, 8, 15, 10],
  [9, 2, 7, 16],
  [3, 12, 13, 6],
  [5, 14, 11, 4],
];

export interface DrawData {
  titulares: readonly DrawEntry[];
  reserves: readonly number[];
}

export type DrawValidation = { ok: true } | { ok: false; error: string };

export function validateDraw(draw: DrawData): DrawValidation {
  if (draw.titulares.length !== 16) {
    return { ok: false, error: "El sorteo debe tener exactamente 16 titulares." };
  }
  if (draw.reserves.length !== 2) {
    return { ok: false, error: "El sorteo debe tener exactamente 2 reservas." };
  }
  const seenPrograms = new Set<number>();
  const seenRiders = new Set<number>();
  for (const entry of draw.titulares) {
    if (!Number.isInteger(entry.programNumber) || entry.programNumber < 1 || entry.programNumber > 16) {
      return { ok: false, error: "Los números de programa deben estar entre 1 y 16." };
    }
    if (seenPrograms.has(entry.programNumber)) {
      return { ok: false, error: `El número de programa ${entry.programNumber} está repetido.` };
    }
    seenPrograms.add(entry.programNumber);
    if (seenRiders.has(entry.riderId)) {
      return { ok: false, error: "Un mismo piloto no puede aparecer dos veces en el sorteo." };
    }
    seenRiders.add(entry.riderId);
  }
  for (const reserveId of draw.reserves) {
    if (seenRiders.has(reserveId)) {
      return { ok: false, error: "Las reservas no pueden estar entre los titulares." };
    }
    seenRiders.add(reserveId);
  }
  return { ok: true };
}

/**
 * Generates heats 1-20 from a draw. Throws if the draw is invalid.
 */
export function buildHeatsFromDraw(draw: DrawData): GeneratedRace[] {
  const validation = validateDraw(draw);
  if (!validation.ok) throw new Error(validation.error);
  const byProgram = new Map<number, number>();
  for (const entry of draw.titulares) byProgram.set(entry.programNumber, entry.riderId);
  return HEAT_SCHEDULE.map((row, index) => ({
    raceNumber: index + 1,
    kind: "heat" as const,
    entries: row.map((programNumber, gateIndex) => ({
      riderId: byProgram.get(programNumber)!,
      gate: gateIndex + 1,
      programNumber,
    })),
  }));
}

/** Heat number (1-20) where two program numbers meet. Each pair meets exactly once. */
export function heatNumberForPrograms(a: number, b: number): number {
  if (a === b) throw new Error("Un programa no comparte heat consigo mismo.");
  for (let i = 0; i < HEAT_SCHEDULE.length; i++) {
    const row = HEAT_SCHEDULE[i]!;
    if (row.includes(a) && row.includes(b)) return i + 1;
  }
  throw new Error(`Los números ${a} y ${b} no comparten heat.`);
}

/** Program numbers (1-16) that share each heat, for verification helpers. */
export function heatsForProgram(programNumber: number): { heat: number; gate: number }[] {
  const out: { heat: number; gate: number }[] = [];
  for (let i = 0; i < HEAT_SCHEDULE.length; i++) {
    const gate = HEAT_SCHEDULE[i]!.indexOf(programNumber);
    if (gate !== -1) out.push({ heat: i + 1, gate: gate + 1 });
  }
  return out;
}
