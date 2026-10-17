export type RaceKind = "heat" | "lcq1" | "lcq2" | "final";

export type RiderStatus = "ok" | "M" | "R" | "F" | "T" | "d" | "N";

export interface RiderRef {
  id: number;
  permanentNumber: number;
}

export interface DrawEntry {
  riderId: number;
  programNumber: number;
}

export interface HeatResultEntry {
  riderId: number;
  gate: number;
  finishPosition: number;
  status: RiderStatus;
  replacedRiderId?: number | null;
}

export interface RaceResultEntry extends HeatResultEntry {
  points: number;
}

export interface GeneratedRaceEntry {
  riderId: number;
  gate: number | null;
  programNumber?: number;
}

export interface GeneratedRace {
  raceNumber: number;
  kind: RaceKind;
  entries: GeneratedRaceEntry[];
}

export const HEAT_POINTS = [3, 2, 1, 0] as const;

export const CHAMPIONSHIP_POINTS = [
  20, 18, 16, 14, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0,
] as const;

export const NON_SCORING_STATUSES: ReadonlySet<RiderStatus> = new Set<RiderStatus>([
  "M",
  "R",
  "F",
  "T",
  "d",
  "N",
]);
