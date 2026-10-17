import {
  buildHeatsFromDraw,
  type DrawData,
  type HeatResultEntry,
  type HeatWithResult,
  type RiderRef,
} from "../src/shared/scoring";

/** 18 riders: ids 1-16 titulares, 17-18 reservas. */
export function makeRiders(
  permanentNumbers?: Record<number, number>,
): RiderRef[] {
  return Array.from({ length: 18 }, (_, i) => {
    const id = i + 1;
    return { id, permanentNumber: permanentNumbers?.[id] ?? id };
  });
}

/** Rider p rides program number p (titulares). */
export function makeProgramNumbers(): Map<number, number> {
  const map = new Map<number, number>();
  for (let p = 1; p <= 16; p++) map.set(p, p);
  return map;
}

export function makeDraw(): DrawData {
  return {
    titulares: Array.from({ length: 16 }, (_, i) => ({
      riderId: i + 1,
      programNumber: i + 1,
    })),
    reserves: [17, 18],
  };
}

/**
 * The 20 heats with a deterministic finishing order: the lowest program
 * number wins every heat, EXCEPT heat 15 where program 16 wins from gate 1.
 *
 * Hand-computed heat points per program:
 * P1=15, P2=14, P3=12, P4=12, P5=9, P6=10, P7=9, P8=8, P9=7, P10=6,
 * P11=5, P12=4, P13=3, P14=2, P15=1, P16=3, reserves=0.
 *
 * Ties: {3,4} at 12 (P3 wins on the direct result in heat 1), {5,7} at 9
 * (P5 wins in heat 2), {13,16} at 3 (P13 wins in heat 4), {17,18} at 0
 * (no criterion, ranks 17-18, no consequence).
 */
export function strengthHeats(): HeatWithResult[] {
  const heats = buildHeatsFromDraw(makeDraw());
  return heats.map((heat) => {
    const byProgram = [...heat.entries].sort((a, b) => a.riderId - b.riderId);
    let entries: HeatResultEntry[] = byProgram.map((entry, index) => ({
      riderId: entry.riderId,
      gate: entry.gate ?? index + 1,
      finishPosition: index + 1,
      status: "ok",
    }));
    if (heat.raceNumber === 15) {
      entries = entries.map((entry) => ({
        ...entry,
        finishPosition:
          entry.riderId === 16 ? 1 : entry.riderId === 3 ? 2 : entry.riderId === 10 ? 3 : 4,
      }));
    }
    return { raceNumber: heat.raceNumber, entries };
  });
}

export function heat(
  raceNumber: number,
  entries: {
    riderId: number;
    gate: number;
    finishPosition: number;
    status?: HeatResultEntry["status"];
    replacedRiderId?: number;
  }[],
): HeatWithResult {
  return {
    raceNumber,
    entries: entries.map((entry) => ({
      riderId: entry.riderId,
      gate: entry.gate,
      finishPosition: entry.finishPosition,
      status: entry.status ?? "ok",
      replacedRiderId: entry.replacedRiderId ?? null,
    })),
  };
}
