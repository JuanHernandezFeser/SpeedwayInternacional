export interface StatsInput {
  /** Every heat entry of every meeting, as effective rider. */
  heatEntries: readonly {
    riderId: number;
    points: number;
    finishPosition: number;
  }[];
  /** Meeting-result ranks per completed meeting. */
  meetingRanks: readonly { riderId: number; rank: number }[];
  /** Number of finals each rider appeared in. */
  finalAppearances: ReadonlyMap<number, number>;
}

export interface RiderStatsRow {
  riderId: number;
  meetingsDisputed: number;
  bestMeetingResult: number | null;
  heatsRaced: number;
  heatWins: number;
  pointsAvg: number;
  finalAppearances: number;
}

/**
 * Per-rider statistics, calculated (never entered by hand):
 * total championship points, meetings disputed, best meeting result, heats
 * raced, heat wins, average points per heat and final appearances.
 */
export function computeStats(input: StatsInput): RiderStatsRow[] {
  const riderIds = new Set<number>();
  for (const entry of input.heatEntries) riderIds.add(entry.riderId);
  for (const row of input.meetingRanks) riderIds.add(row.riderId);
  for (const riderId of input.finalAppearances.keys()) riderIds.add(riderId);

  const rows: RiderStatsRow[] = [];
  for (const riderId of riderIds) {
    const heats = input.heatEntries.filter((e) => e.riderId === riderId);
    const ranks = input.meetingRanks.filter((r) => r.riderId === riderId);
    const heatsRaced = heats.length;
    const totalHeatPoints = heats.reduce((s, e) => s + e.points, 0);
    rows.push({
      riderId,
      meetingsDisputed: ranks.length,
      bestMeetingResult: ranks.length > 0 ? Math.min(...ranks.map((r) => r.rank)) : null,
      heatsRaced,
      heatWins: heats.filter((e) => e.finishPosition === 1).length,
      pointsAvg: heatsRaced > 0 ? totalHeatPoints / heatsRaced : 0,
      finalAppearances: input.finalAppearances.get(riderId) ?? 0,
    });
  }
  return rows;
}
