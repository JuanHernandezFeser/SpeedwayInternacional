import type { IntermediateResult } from "./intermediate";
import { CHAMPIONSHIP_POINTS, type RaceResultEntry } from "./types";

export interface MeetingResultInput {
  intermediate: IntermediateResult;
  lcq1: readonly RaceResultEntry[];
  lcq2: readonly RaceResultEntry[];
  final: readonly RaceResultEntry[];
}

export interface MeetingResultRow {
  rank: number;
  riderId: number;
  championshipPoints: number;
}

/**
 * Meeting classification (1st to 18th) and championship points for the
 * meeting.
 *
 * - 1st to 4th: final result.
 * - 5th/6th: the LCQ runners-up, the best intermediate position first. If only
 *   one of the two did not complete the race, that one is placed last in the
 *   pair. Same for 7th/8th (LCQ thirds) and 9th/10th (LCQ fourths).
 * - 11th to 18th: intermediate classification.
 */
export function computeMeetingResult(input: MeetingResultInput): MeetingResultRow[] {
  const { intermediate, lcq1, lcq2, final } = input;
  if (intermediate.hasBlockedTies) {
    throw new Error("No se puede calcular la clasificación con empates pendientes de resolución manual.");
  }
  const interRank = new Map(intermediate.rows.map((row) => [row.riderId, row.rank]));

  const finalOrdered = [...final].sort((a, b) => a.finishPosition - b.finishPosition);
  const rows: MeetingResultRow[] = finalOrdered.map((entry) => ({
    rank: entry.finishPosition,
    riderId: entry.riderId,
    championshipPoints: CHAMPIONSHIP_POINTS[entry.finishPosition - 1] ?? 0,
  }));

  for (const [lcqPos, firstRank] of [2, 3, 4].map((p, idx) => [p, 5 + idx * 2] as const)) {
    const a = lcq1.find((e) => e.finishPosition === lcqPos)!;
    const b = lcq2.find((e) => e.finishPosition === lcqPos)!;
    const aCompleted = a.status === "ok";
    const bCompleted = b.status === "ok";
    let better: RaceResultEntry;
    let worse: RaceResultEntry;
    if (aCompleted !== bCompleted) {
      if (aCompleted) {
        better = a;
        worse = b;
      } else {
        better = b;
        worse = a;
      }
    } else {
      const rankA = interRank.get(a.riderId)!;
      const rankB = interRank.get(b.riderId)!;
      if (rankA <= rankB) {
        better = a;
        worse = b;
      } else {
        better = b;
        worse = a;
      }
    }
    rows.push({
      rank: firstRank,
      riderId: better.riderId,
      championshipPoints: CHAMPIONSHIP_POINTS[firstRank - 1] ?? 0,
    });
    rows.push({
      rank: firstRank + 1,
      riderId: worse.riderId,
      championshipPoints: CHAMPIONSHIP_POINTS[firstRank] ?? 0,
    });
  }

  const rest = intermediate.rows.filter((row) => row.rank >= 11).sort((a, b) => a.rank - b.rank);
  for (const row of rest) {
    rows.push({
      rank: row.rank,
      riderId: row.riderId,
      championshipPoints: CHAMPIONSHIP_POINTS[row.rank - 1] ?? 0,
    });
  }

  rows.sort((a, b) => a.rank - b.rank);
  if (rows.length !== 18) {
    throw new Error(`La clasificación de la fecha debe tener 18 pilotos, se obtuvieron ${rows.length}.`);
  }
  return rows;
}
