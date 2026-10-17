import type { IntermediateResult } from "./intermediate";
import type { GeneratedRace, RaceResultEntry } from "./types";

/**
 * Generates LCQ1 (race 21) and LCQ2 (race 22) from the intermediate
 * classification. Returns null while the intermediate has ties that require
 * manual resolution.
 *
 * LCQ1: intermediate 3rd, 6th, 8th and 9th, from gate 1 to gate 4.
 * LCQ2: intermediate 4th, 5th, 7th and 10th, from gate 1 to gate 4.
 */
export function generateLcqs(intermediate: IntermediateResult): [GeneratedRace, GeneratedRace] | null {
  if (intermediate.hasBlockedTies) return null;
  const byRank = new Map(intermediate.rows.map((row) => [row.rank, row.riderId]));
  const lcq1Ranks = [3, 6, 8, 9];
  const lcq2Ranks = [4, 5, 7, 10];
  const build = (raceNumber: 21 | 22, kind: "lcq1" | "lcq2", ranks: number[]): GeneratedRace => ({
    raceNumber,
    kind,
    entries: ranks.map((rank, gateIndex) => ({
      riderId: byRank.get(rank)!,
      gate: gateIndex + 1,
    })),
  });
  return [build(21, "lcq1", lcq1Ranks), build(22, "lcq2", lcq2Ranks)];
}

/**
 * Generates the final (race 23) with the 4 qualified riders and NO gates.
 * Entries are in gate-choice order: first the 2 best of the intermediate
 * (by intermediate position), then the LCQ winners (ordered by their
 * intermediate position).
 */
export function generateFinalRace(
  intermediate: IntermediateResult,
  lcq1Result: readonly RaceResultEntry[],
  lcq2Result: readonly RaceResultEntry[],
): GeneratedRace {
  if (intermediate.hasBlockedTies) {
    throw new Error("No se puede generar la final con empates pendientes de resolución manual.");
  }
  const interRank = new Map(intermediate.rows.map((row) => [row.riderId, row.rank]));
  const direct = intermediate.rows.filter((row) => row.rank <= 2).map((row) => row.riderId);
  const winners = [
    ...lcq1Result.filter((e) => e.finishPosition === 1).map((e) => e.riderId),
    ...lcq2Result.filter((e) => e.finishPosition === 1).map((e) => e.riderId),
  ];
  const ordered = [...direct, ...winners].sort(
    (a, b) => (interRank.get(a) ?? 99) - (interRank.get(b) ?? 99),
  );
  return {
    raceNumber: 23,
    kind: "final",
    entries: ordered.map((riderId) => ({ riderId, gate: null })),
  };
}
