import {
  computeChampionship,
  computeIntermediate,
  computeMeetingResult,
  computeStats,
  generateFinalRace,
  generateLcqs,
  type HeatResultEntry,
  type HeatWithResult,
  type IntermediateResult,
  type RaceResultEntry,
  type RiderRef,
  type RiderStatus,
} from "../shared/scoring";
import { execute, executeBatch, insert, placeholders, queryAll, queryOne } from "./db";
import { HttpError } from "./http";
import type {
  D1Database,
  IntermediateStandingRow,
  MeetingEntryRow,
  MeetingResultRow,
  MeetingRow,
  RaceEntryRow,
  RaceRow,
  RiderRow,
} from "./types";

export interface MeetingContext {
  meeting: MeetingRow;
  entries: MeetingEntryRow[];
  riders: RiderRow[];
  programNumbers: Map<number, number>;
  races: RaceRow[];
  raceEntries: RaceEntryRow[];
}

export async function loadMeetingContext(
  db: D1Database,
  meetingId: number,
): Promise<MeetingContext> {
  const meeting = await queryOne<MeetingRow>(db, "SELECT * FROM meetings WHERE id = ?", [
    meetingId,
  ]);
  if (!meeting) throw new HttpError(404, "Fecha no encontrada.");
  const entries = await queryAll<MeetingEntryRow>(
    db,
    "SELECT * FROM meeting_entries WHERE meeting_id = ?",
    [meetingId],
  );
  const riders = await queryAll<RiderRow>(db, "SELECT * FROM riders ORDER BY permanent_number");
  const races = await queryAll<RaceRow>(
    db,
    "SELECT * FROM races WHERE meeting_id = ? ORDER BY race_number",
    [meetingId],
  );
  const raceIds = races.map((race) => race.id);
  const raceEntries =
    raceIds.length > 0
      ? await queryAll<RaceEntryRow>(
          db,
          `SELECT * FROM race_entries WHERE race_id IN (${placeholders(raceIds.length)})`,
          raceIds,
        )
      : [];
  const programNumbers = new Map<number, number>();
  for (const entry of entries) {
    if (entry.program_number !== null) programNumbers.set(entry.rider_id, entry.program_number);
  }
  return { meeting, entries, riders, programNumbers, races, raceEntries };
}

export function meetingRiderRefs(ctx: MeetingContext): RiderRef[] {
  return ctx.entries.map((entry) => {
    const rider = ctx.riders.find((r) => r.id === entry.rider_id);
    if (!rider) throw new HttpError(500, "Piloto del sorteo inexistente.");
    return { id: rider.id, permanentNumber: rider.permanent_number };
  });
}

export function entriesOfRace(ctx: MeetingContext, raceNumber: number): RaceEntryRow[] {
  const race = ctx.races.find((r) => r.race_number === raceNumber);
  if (!race) return [];
  return ctx.raceEntries.filter((entry) => entry.race_id === race.id);
}

export function raceEntriesAsResults(entries: RaceEntryRow[]): RaceResultEntry[] {
  return entries.map((entry) => ({
    riderId: entry.rider_id,
    gate: entry.gate ?? 0,
    finishPosition: entry.finish_position ?? 0,
    status: entry.status as RiderStatus,
    replacedRiderId: entry.replaced_rider_id,
    points: entry.points ?? 0,
  }));
}

function heatsFromContext(ctx: MeetingContext): HeatWithResult[] | null {
  const heats: HeatWithResult[] = [];
  for (let raceNumber = 1; raceNumber <= 20; raceNumber++) {
    const race = ctx.races.find((r) => r.race_number === raceNumber);
    if (!race || race.status !== "completed") return null;
    const entries: HeatResultEntry[] = ctx.raceEntries
      .filter((entry) => entry.race_id === race.id)
      .map((entry) => ({
        riderId: entry.rider_id,
        gate: entry.gate ?? 0,
        finishPosition: entry.finish_position!,
        status: entry.status as RiderStatus,
        replacedRiderId: entry.replaced_rider_id,
      }));
    heats.push({ raceNumber, entries });
  }
  return heats;
}

function manualOrdersFromRows(rows: IntermediateStandingRow[]): number[][] {
  const byPoints = new Map<number, { riderId: number; manualOrder: number }[]>();
  for (const row of rows) {
    if (row.manual_order === null) continue;
    const list = byPoints.get(row.heat_points) ?? [];
    list.push({ riderId: row.rider_id, manualOrder: row.manual_order });
    byPoints.set(row.heat_points, list);
  }
  return [...byPoints.values()].map((list) =>
    [...list].sort((a, b) => a.manualOrder - b.manualOrder).map((item) => item.riderId),
  );
}

/**
 * Recomputes and persists the intermediate classification. Returns null when
 * not all 20 heats are completed (in which case stored standings are cleared).
 */
export async function recomputeIntermediate(
  db: D1Database,
  ctx: MeetingContext,
): Promise<IntermediateResult | null> {
  const heats = heatsFromContext(ctx);
  if (!heats) {
    await execute(db, "DELETE FROM intermediate_standings WHERE meeting_id = ?", [ctx.meeting.id]);
    return null;
  }
  const currentRows = await queryAll<IntermediateStandingRow>(
    db,
    "SELECT * FROM intermediate_standings WHERE meeting_id = ?",
    [ctx.meeting.id],
  );
  const intermediate = computeIntermediate({
    riders: meetingRiderRefs(ctx),
    programNumbers: ctx.programNumbers,
    heats,
    manualOrders: manualOrdersFromRows(currentRows),
  });
  const statements = [
    { sql: "DELETE FROM intermediate_standings WHERE meeting_id = ?", params: [ctx.meeting.id] },
    ...intermediate.rows.map((row) => ({
      sql: `INSERT INTO intermediate_standings
              (meeting_id, rider_id, heat_points, rank, requires_manual_resolution, manual_order)
            VALUES (?, ?, ?, ?, ?, ?)`,
      params: [
        ctx.meeting.id,
        row.riderId,
        row.heatPoints,
        row.rank,
        row.requiresManualResolution ? 1 : 0,
        row.manualOrder,
      ],
    })),
  ];
  await executeBatch(db, statements);
  return intermediate;
}

export function intermediateFromRows(rows: IntermediateStandingRow[]): IntermediateResult {
  const ordered = [...rows].sort((a, b) => a.rank - b.rank);
  const result: IntermediateResult = {
    rows: ordered.map((row) => ({
      riderId: row.rider_id,
      heatPoints: row.heat_points,
      rank: row.rank,
      requiresManualResolution: row.requires_manual_resolution === 1,
      manualOrder: row.manual_order,
    })),
    hasBlockedTies: ordered.some((row) => row.requires_manual_resolution === 1),
    blockedGroups: [],
  };
  const grouped = new Map<number, IntermediateStandingRow[]>();
  for (const row of ordered) {
    if (row.requires_manual_resolution !== 1) continue;
    const list = grouped.get(row.heat_points) ?? [];
    list.push(row);
    grouped.set(row.heat_points, list);
  }
  result.blockedGroups = [...grouped.values()].map((list) =>
    list.sort((a, b) => a.rank - b.rank).map((row) => row.rider_id),
  );
  return result;
}

export async function deleteRaces(
  db: D1Database,
  meetingId: number,
  raceNumbers: number[],
): Promise<void> {
  if (raceNumbers.length === 0) return;
  const numbers = placeholders(raceNumbers.length);
  await execute(
    db,
    `DELETE FROM race_entries WHERE race_id IN
       (SELECT id FROM races WHERE meeting_id = ? AND race_number IN (${numbers}))`,
    [meetingId, ...raceNumbers],
  );
  await execute(db, `DELETE FROM races WHERE meeting_id = ? AND race_number IN (${numbers})`, [
    meetingId,
    ...raceNumbers,
  ]);
}

export async function insertRace(
  db: D1Database,
  meetingId: number,
  raceNumber: number,
  kind: string,
): Promise<number> {
  return insert(
    db,
    "INSERT INTO races (meeting_id, race_number, kind, status) VALUES (?, ?, ?, 'pending')",
    [meetingId, raceNumber, kind],
  );
}

export async function insertRaceEntries(
  db: D1Database,
  raceId: number,
  entries: { riderId: number; gate: number | null; replacedRiderId?: number | null }[],
): Promise<void> {
  await executeBatch(
    db,
    entries.map((entry) => ({
      sql: `INSERT INTO race_entries (race_id, rider_id, replaced_rider_id, gate)
            VALUES (?, ?, ?, ?)`,
      params: [raceId, entry.riderId, entry.replacedRiderId ?? null, entry.gate],
    })),
  );
}

/**
 * Applies the intermediate classification downstream: removes races 21-23 and
 * recreates the LCQs when the intermediate is ready and without blocked ties.
 */
export async function syncRacesFromIntermediate(
  db: D1Database,
  ctx: MeetingContext,
  intermediate: IntermediateResult | null,
): Promise<void> {
  await deleteRaces(db, ctx.meeting.id, [21, 22, 23]);
  if (!intermediate) return;
  const lcqs = generateLcqs(intermediate);
  if (!lcqs) return;
  for (const race of lcqs) {
    const raceId = await insertRace(db, ctx.meeting.id, race.raceNumber, race.kind);
    await insertRaceEntries(
      db,
      raceId,
      race.entries.map((entry) => ({ riderId: entry.riderId, gate: entry.gate })),
    );
  }
}

/** Rebuilds the final (race 23) from the LCQ results, if both are completed. */
export async function rebuildFinalFromLcqs(db: D1Database, meetingId: number): Promise<void> {
  await deleteRaces(db, meetingId, [23]);
  const ctx = await loadMeetingContext(db, meetingId);
  const race21 = ctx.races.find((r) => r.race_number === 21);
  const race22 = ctx.races.find((r) => r.race_number === 22);
  if (!race21 || !race22 || race21.status !== "completed" || race22.status !== "completed") {
    return;
  }
  const rows = await queryAll<IntermediateStandingRow>(
    db,
    "SELECT * FROM intermediate_standings WHERE meeting_id = ?",
    [meetingId],
  );
  const intermediate = intermediateFromRows(rows);
  if (intermediate.hasBlockedTies) return;
  const final = generateFinalRace(
    intermediate,
    raceEntriesAsResults(entriesOfRace(ctx, 21)),
    raceEntriesAsResults(entriesOfRace(ctx, 22)),
  );
  const raceId = await insertRace(db, meetingId, 23, "final");
  await insertRaceEntries(
    db,
    raceId,
    final.entries.map((entry) => ({ riderId: entry.riderId, gate: null })),
  );
}

/** Persists (or clears) the meeting classification from the final result. */
export async function recomputeMeetingClassification(
  db: D1Database,
  ctx: MeetingContext,
): Promise<void> {
  const finalRace = ctx.races.find((race) => race.race_number === 23);
  const complete = finalRace?.status === "completed";
  if (!complete) {
    await execute(db, "DELETE FROM meeting_results WHERE meeting_id = ?", [ctx.meeting.id]);
    return;
  }
  const rows = await queryAll<IntermediateStandingRow>(
    db,
    "SELECT * FROM intermediate_standings WHERE meeting_id = ?",
    [ctx.meeting.id],
  );
  const intermediate = intermediateFromRows(rows);
  if (intermediate.hasBlockedTies) {
    await execute(db, "DELETE FROM meeting_results WHERE meeting_id = ?", [ctx.meeting.id]);
    return;
  }
  const result = computeMeetingResult({
    intermediate,
    lcq1: raceEntriesAsResults(entriesOfRace(ctx, 21)),
    lcq2: raceEntriesAsResults(entriesOfRace(ctx, 22)),
    final: raceEntriesAsResults(entriesOfRace(ctx, 23)),
  });
  await executeBatch(db, [
    { sql: "DELETE FROM meeting_results WHERE meeting_id = ?", params: [ctx.meeting.id] },
    ...result.map((row) => ({
      sql: `INSERT INTO meeting_results (meeting_id, rider_id, rank, championship_points)
            VALUES (?, ?, ?, ?)`,
      params: [ctx.meeting.id, row.riderId, row.rank, row.championshipPoints],
    })),
  ]);
}

/** Recomputes the championship table and per-rider statistics from scratch. */
export async function recomputeChampionshipAndStats(db: D1Database): Promise<void> {
  const riders = await queryAll<RiderRow>(db, "SELECT * FROM riders ORDER BY permanent_number");
  const results = await queryAll<MeetingResultRow>(db, "SELECT * FROM meeting_results");
  const pointsPerRider = new Map<number, number[]>();
  for (const row of results) {
    const list = pointsPerRider.get(row.rider_id) ?? [];
    list.push(row.championship_points);
    pointsPerRider.set(row.rider_id, list);
  }
  const championship = computeChampionship({
    riders: riders.map((rider) => ({ id: rider.id, permanentNumber: rider.permanent_number })),
    pointsPerRider,
  });
  const statsHeatEntries = await queryAll<{
    riderId: number;
    points: number;
    finishPosition: number;
  }>(
    db,
    `SELECT re.rider_id AS riderId, re.points AS points, re.finish_position AS finishPosition
     FROM race_entries re
     JOIN races r ON r.id = re.race_id
     WHERE r.kind = 'heat' AND r.status = 'completed' AND re.finish_position IS NOT NULL`,
  );
  const finalRows = await queryAll<{ rider_id: number; count: number }>(
    db,
    `SELECT re.rider_id, COUNT(*) AS count
     FROM race_entries re
     JOIN races r ON r.id = re.race_id
     WHERE r.kind = 'final' AND r.status = 'completed'
     GROUP BY re.rider_id`,
  );
  const stats = computeStats({
    heatEntries: statsHeatEntries.map((row) => ({
      riderId: row.riderId,
      points: row.points ?? 0,
      finishPosition: row.finishPosition,
    })),
    meetingRanks: results.map((row) => ({ riderId: row.rider_id, rank: row.rank })),
    finalAppearances: new Map(finalRows.map((row) => [row.rider_id, row.count])),
  });

  await executeBatch(db, [
    { sql: "DELETE FROM championship_standings", params: [] },
    { sql: "DELETE FROM rider_stats", params: [] },
    ...championship.map((row) => ({
      sql: `INSERT INTO championship_standings (rider_id, rank, total_points, updated_at)
            VALUES (?, ?, ?, datetime('now'))`,
      params: [row.riderId, row.rank, row.totalPoints],
    })),
    ...stats.map((row) => ({
      sql: `INSERT INTO rider_stats
              (rider_id, meetings_disputed, best_meeting_result, heats_raced, heat_wins,
               points_avg, final_appearances)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [
        row.riderId,
        row.meetingsDisputed,
        row.bestMeetingResult,
        row.heatsRaced,
        row.heatWins,
        row.pointsAvg,
        row.finalAppearances,
      ],
    })),
  ]);
}

/** Stores the manual order chosen by the administrator for a tied group. */
export async function resolveIntermediateInRows(
  db: D1Database,
  meetingId: number,
  riderIds: number[],
): Promise<void> {
  await executeBatch(
    db,
    riderIds.map((riderId, index) => ({
      sql: "UPDATE intermediate_standings SET manual_order = ? WHERE meeting_id = ? AND rider_id = ?",
      params: [index, meetingId, riderId],
    })),
  );
}

export async function updateMeetingStatus(db: D1Database, meetingId: number): Promise<void> {
  const races = await queryAll<RaceRow>(
    db,
    "SELECT * FROM races WHERE meeting_id = ? ORDER BY race_number",
    [meetingId],
  );
  const finalCompleted = races.some((race) => race.race_number === 23 && race.status === "completed");
  const anyCompleted = races.some((race) => race.status === "completed");
  const status = finalCompleted
    ? "completed"
    : anyCompleted
      ? "in_progress"
      : races.length > 0
        ? "drawn"
        : "scheduled";
  await execute(db, "UPDATE meetings SET status = ?, updated_at = datetime('now') WHERE id = ?", [
    status,
    meetingId,
  ]);
}

export async function meetingHasResults(db: D1Database, meetingId: number): Promise<boolean> {
  const row = await queryOne<{ count: number }>(
    db,
    "SELECT COUNT(*) AS count FROM races WHERE meeting_id = ? AND status = 'completed'",
    [meetingId],
  );
  return (row?.count ?? 0) > 0;
}
