import type { RiderRef } from "./types";

export interface ChampionshipInput {
  riders: readonly RiderRef[];
  /** Championship points scored by each rider on each completed meeting. */
  pointsPerRider: ReadonlyMap<number, number[]>;
}

export interface ChampionshipRow {
  rank: number;
  riderId: number;
  totalPoints: number;
  /** True when another rider shares the same rank. */
  tied: boolean;
}

/**
 * Championship table. Riders are ordered by total points (descending).
 * Tied riders share the same rank (standard competition ranking: 1, 2, 2, 4)
 * and are shown as tied; there is no defined tie-break criterion.
 */
export function computeChampionship(input: ChampionshipInput): ChampionshipRow[] {
  const { riders, pointsPerRider } = input;
  const sorted = [...riders].sort((a, b) => {
    const totalA = (pointsPerRider.get(a.id) ?? []).reduce((s, p) => s + p, 0);
    const totalB = (pointsPerRider.get(b.id) ?? []).reduce((s, p) => s + p, 0);
    if (totalB !== totalA) return totalB - totalA;
    return a.permanentNumber - b.permanentNumber;
  });
  const rows: ChampionshipRow[] = sorted.map((rider) => ({
    rank: 0,
    riderId: rider.id,
    totalPoints: (pointsPerRider.get(rider.id) ?? []).reduce((s, p) => s + p, 0),
    tied: false,
  }));
  for (let i = 0; i < rows.length; i++) {
    const prev = rows[i - 1];
    const current = rows[i]!;
    current.rank = i === 0 || current.totalPoints !== prev!.totalPoints ? i + 1 : prev!.rank;
  }
  for (let i = 0; i < rows.length; i++) {
    const current = rows[i]!;
    current.tied = rows.some((row, j) => j !== i && row.rank === current.rank);
  }
  return rows;
}
