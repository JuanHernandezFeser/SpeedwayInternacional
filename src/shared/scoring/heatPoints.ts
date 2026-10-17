import { HEAT_POINTS, NON_SCORING_STATUSES, type HeatResultEntry, type RiderStatus } from "./types";

/**
 * A valid finishing order for a 4-rider race: every rider gets a position
 * between 1 and 4; dead heats share a position; positions are competition
 * ranks (e.g. 1,1,3,4 for a dead heat for first).
 */
export function isValidRaceOrder(positions: readonly number[]): boolean {
  if (positions.length !== 4) return false;
  for (const p of positions) {
    if (!Number.isInteger(p) || p < 1 || p > 4) return false;
  }
  const distinct = [...new Set(positions)].sort((a, b) => a - b);
  for (const p of distinct) {
    const below = positions.filter((x) => x < p).length;
    if (p !== below + 1) return false;
  }
  return true;
}

/**
 * Points for a heat (races 1-20).
 *
 * Points are assigned by finishing position (3/2/1/0). A dead heat shares the
 * sum of the points of the positions involved among the tied riders (e.g. a
 * tie for first shares 3+2=5, so 2.5 each). Riders with a non-scoring status
 * get 0 points without redistributing their share.
 */
export function computeHeatPoints(entries: readonly HeatResultEntry[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const entry of entries) {
    counts.set(entry.finishPosition, (counts.get(entry.finishPosition) ?? 0) + 1);
  }
  const points = new Map<number, number>();
  for (const entry of entries) {
    const p = entry.finishPosition;
    const k = counts.get(p)!;
    let sum = 0;
    for (let pos = p; pos < p + k; pos++) sum += HEAT_POINTS[pos - 1] ?? 0;
    const shared = sum / k;
    points.set(entry.riderId, NON_SCORING_STATUSES.has(entry.status) ? 0 : shared);
  }
  return points;
}

export function isNonScoringStatus(status: RiderStatus): boolean {
  return NON_SCORING_STATUSES.has(status);
}
