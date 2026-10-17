import { heatNumberForPrograms } from "./heatSchedule";
import { computeHeatPoints } from "./heatPoints";
import { NON_SCORING_STATUSES, type HeatResultEntry, type RiderRef } from "./types";

export interface HeatWithResult {
  raceNumber: number;
  entries: readonly HeatResultEntry[];
}

export interface IntermediateInput {
  /** All 18 riders of the meeting (16 titulares + 2 reservas). */
  riders: readonly RiderRef[];
  /** Program number per rider id (titulares only). */
  programNumbers: ReadonlyMap<number, number>;
  /** The 20 heats, in race-number order. */
  heats: readonly HeatWithResult[];
  /**
   * Groups already resolved by the administrator: each entry is the list of
   * rider ids of one tied group, in the manual order. Stale groups (rider
   * sets that no longer match a tied group) are ignored.
   */
  manualOrders?: readonly (readonly number[])[];
}

export interface IntermediateRow {
  riderId: number;
  heatPoints: number;
  rank: number;
  requiresManualResolution: boolean;
  manualOrder: number | null;
}

export interface IntermediateResult {
  rows: IntermediateRow[];
  hasBlockedTies: boolean;
  /** Rider-id groups that require manual resolution (in rank order). */
  blockedGroups: number[][];
}

function directCriterionOrder(
  a: RiderRef,
  b: RiderRef,
  programNumbers: ReadonlyMap<number, number>,
  heats: readonly HeatWithResult[],
): "a" | "b" | null {
  const programA = programNumbers.get(a.id);
  const programB = programNumbers.get(b.id);
  if (programA === undefined || programB === undefined) return null;
  let heatNumber: number;
  try {
    heatNumber = heatNumberForPrograms(programA, programB);
  } catch {
    return null;
  }
  const heat = heats.find((h) => h.raceNumber === heatNumber);
  if (!heat) return null;
  const entryA = heat.entries.find((e) => e.riderId === a.id);
  const entryB = heat.entries.find((e) => e.riderId === b.id);
  if (entryA && entryB) {
    if (entryA.finishPosition < entryB.finishPosition) return "a";
    if (entryB.finishPosition < entryA.finishPosition) return "b";
    return null;
  }
  if (entryA) return "a";
  if (entryB) return "b";
  return null;
}

/**
 * Intermediate classification (after heat 20) from accumulated heat points.
 *
 * Ties are broken by the direct result in the shared heat when possible. When
 * there is no criterion (neither rode the shared heat, or a tie of 3+ riders)
 * and the order would change a result (direct qualification for the final,
 * LCQ composition, or different meeting points — everything except the 17th
 * and 18th places, both worth 0 points), the tie is flagged as requiring
 * manual resolution. Ties without consequences are ordered stably by
 * permanent number and do not block the LCQ generation.
 */
export function computeIntermediate(input: IntermediateInput): IntermediateResult {
  const { riders, programNumbers, heats, manualOrders = [] } = input;

  const points = new Map<number, number>(riders.map((r) => [r.id, 0]));
  for (const heat of heats) {
    const heatPts = computeHeatPoints(heat.entries);
    for (const [riderId, p] of heatPts) {
      points.set(riderId, (points.get(riderId) ?? 0) + p);
    }
  }

  const byPoints = [...riders].sort((a, b) => {
    const pa = points.get(a.id)!;
    const pb = points.get(b.id)!;
    if (pb !== pa) return pb - pa;
    return a.permanentNumber - b.permanentNumber;
  });

  const rows: IntermediateRow[] = [];
  const blockedGroups: number[][] = [];
  let i = 0;
  while (i < byPoints.length) {
    let j = i;
    const groupPoints = points.get(byPoints[i]!.id)!;
    while (j < byPoints.length && points.get(byPoints[j]!.id) === groupPoints) j++;
    const group = byPoints.slice(i, j);
    if (group.length === 1) {
      rows.push({
        riderId: group[0]!.id,
        heatPoints: groupPoints,
        rank: rows.length + 1,
        requiresManualResolution: false,
        manualOrder: null,
      });
    } else {
      const manual = manualOrders.find(
        (order) =>
          order.length === group.length && order.every((id) => group.some((r) => r.id === id)),
      );
      let ordered: RiderRef[];
      let blocked: boolean;
      let manualOrder: number[] | null = null;
      if (manual) {
        const manualIndex = new Map(manual.map((id, idx) => [id, idx]));
        ordered = [...group].sort((a, b) => manualIndex.get(a.id)! - manualIndex.get(b.id)!);
        blocked = false;
        manualOrder = manual as number[];
      } else if (group.length === 2) {
        const criterion = directCriterionOrder(group[0]!, group[1]!, programNumbers, heats);
        if (criterion === "a") {
          ordered = [group[0]!, group[1]!];
          blocked = false;
        } else if (criterion === "b") {
          ordered = [group[1]!, group[0]!];
          blocked = false;
        } else {
          ordered = group;
          // A 2-rider tie without criterion only blocks when the order can
          // change a result: ranks 1-16 (points, direct final, LCQs). A tie
          // occupying only ranks 17-18 is worth 0 points either way.
          blocked = rows.length + 1 <= 16;
        }
      } else {
        ordered = group;
        blocked = rows.length + 1 <= 16;
      }
      if (blocked) blockedGroups.push(ordered.map((r) => r.id));
      ordered.forEach((rider, idx) => {
        rows.push({
          riderId: rider.id,
          heatPoints: groupPoints,
          rank: rows.length + 1,
          requiresManualResolution: blocked,
          manualOrder: manualOrder ? manualOrder.indexOf(rider.id) : null,
        });
      });
    }
    i = j;
  }

  return { rows, hasBlockedTies: blockedGroups.length > 0, blockedGroups };
}
