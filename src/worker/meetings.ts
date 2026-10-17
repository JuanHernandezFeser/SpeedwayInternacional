import {
  buildHeatsFromDraw,
  computeHeatPoints,
  isValidRaceOrder,
  validateDraw,
  type HeatResultEntry,
  type RiderStatus,
} from "../shared/scoring";
import {
  badRequest,
  conflict,
  HttpError,
  asArray,
  asInt,
  asRecord,
  asString,
} from "./http";
import { execute, executeBatch, placeholders, queryAll, queryOne } from "./db";
import {
  deleteRaces,
  entriesOfRace,
  insertRace,
  insertRaceEntries,
  loadMeetingContext,
  meetingHasResults,
  rebuildFinalFromLcqs,
  recomputeChampionshipAndStats,
  recomputeIntermediate,
  recomputeMeetingClassification,
  resolveIntermediateInRows,
  syncRacesFromIntermediate,
  updateMeetingStatus,
} from "./standings";
import type { D1Database, IntermediateStandingRow } from "./types";

const VALID_STATUSES: readonly RiderStatus[] = ["ok", "M", "R", "F", "T", "d", "N"];

export interface DrawInput {
  titulares: { riderId: number; programNumber: number }[];
  reserves: number[];
}

export function parseDrawInput(raw: unknown): DrawInput {
  const record = asRecord(raw, "sorteo");
  const titulares = asArray(record.titulares, "titulares").map((item, index) => {
    const entry = asRecord(item, `titulares[${index}]`);
    return {
      riderId: asInt(entry.riderId, `titulares[${index}].riderId`),
      programNumber: asInt(entry.programNumber, `titulares[${index}].programNumber`),
    };
  });
  const reserves = asArray(record.reserves, "reserves").map((item, index) =>
    asInt(item, `reserves[${index}]`),
  );
  const validation = validateDraw({ titulares, reserves });
  if (!validation.ok) throw badRequest(validation.error);
  return { titulares, reserves };
}

async function ensureRidersExist(db: D1Database, riderIds: number[]): Promise<void> {
  if (riderIds.length === 0) return;
  const rows = await queryAll<{ id: number }>(
    db,
    `SELECT id FROM riders WHERE id IN (${placeholders(riderIds.length)})`,
    riderIds,
  );
  const found = new Set(rows.map((row) => row.id));
  const missing = riderIds.filter((id) => !found.has(id));
  if (missing.length > 0) throw badRequest(`Pilotos inexistentes: ${missing.join(", ")}.`);
}

function setEquals(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((value) => setB.has(value)) && new Set(a).size === setB.size;
}

/** Saves a draw (draft) into meeting_entries, without generating races. */
export async function saveDraw(
  db: D1Database,
  meetingId: number,
  draw: DrawInput,
): Promise<void> {
  const meeting = await queryOne<{ id: number }>(db, "SELECT id FROM meetings WHERE id = ?", [
    meetingId,
  ]);
  if (!meeting) throw new HttpError(404, "Fecha no encontrada.");
  if (await meetingHasResults(db, meetingId)) {
    throw conflict(
      "El sorteo no puede modificarse si la fecha ya tiene resultados cargados. Para rehacerlo hay que confirmar el borrado de los resultados.",
    );
  }
  await ensureRidersExist(db, [
    ...draw.titulares.map((entry) => entry.riderId),
    ...draw.reserves,
  ]);
  await executeBatch(db, [
    { sql: "DELETE FROM meeting_entries WHERE meeting_id = ?", params: [meetingId] },
    ...draw.titulares.map((entry) => ({
      sql: `INSERT INTO meeting_entries (meeting_id, rider_id, program_number, is_reserve)
            VALUES (?, ?, ?, 0)`,
      params: [meetingId, entry.riderId, entry.programNumber],
    })),
    ...draw.reserves.map((riderId) => ({
      sql: `INSERT INTO meeting_entries (meeting_id, rider_id, program_number, is_reserve)
            VALUES (?, ?, NULL, 1)`,
      params: [meetingId, riderId],
    })),
  ]);
}

/** Confirms the draw and generates heats 1-20. */
export async function confirmDraw(
  db: D1Database,
  meetingId: number,
  draw: DrawInput,
): Promise<void> {
  await saveDraw(db, meetingId, draw);
  await deleteRaces(
    db,
    meetingId,
    Array.from({ length: 23 }, (_, index) => index + 1),
  );
  await execute(db, "DELETE FROM intermediate_standings WHERE meeting_id = ?", [meetingId]);
  await execute(db, "DELETE FROM meeting_results WHERE meeting_id = ?", [meetingId]);
  const heats = buildHeatsFromDraw(draw);
  for (const heat of heats) {
    const raceId = await insertRace(db, meetingId, heat.raceNumber, heat.kind);
    await insertRaceEntries(
      db,
      raceId,
      heat.entries.map((entry) => ({ riderId: entry.riderId, gate: entry.gate })),
    );
  }
  await updateMeetingStatus(db, meetingId);
  await recomputeChampionshipAndStats(db);
}

/** Redoes the draw, discarding all results of the meeting. Requires confirmation. */
export async function redoDraw(
  db: D1Database,
  meetingId: number,
  confirm: boolean,
): Promise<void> {
  if (!confirm) {
    throw badRequest(
      "Rehacer el sorteo borra todos los resultados de la fecha. Se requiere confirm=true.",
    );
  }
  const meeting = await queryOne<{ id: number }>(db, "SELECT id FROM meetings WHERE id = ?", [
    meetingId,
  ]);
  if (!meeting) throw new HttpError(404, "Fecha no encontrada.");
  await deleteRaces(
    db,
    meetingId,
    Array.from({ length: 23 }, (_, index) => index + 1),
  );
  await execute(db, "DELETE FROM intermediate_standings WHERE meeting_id = ?", [meetingId]);
  await execute(db, "DELETE FROM meeting_results WHERE meeting_id = ?", [meetingId]);
  await execute(db, "DELETE FROM meeting_entries WHERE meeting_id = ?", [meetingId]);
  await updateMeetingStatus(db, meetingId);
  await recomputeChampionshipAndStats(db);
}

export interface ResultEntryInput {
  riderId: number;
  gate: number;
  finishPosition: number;
  status: RiderStatus;
  replacedRiderId: number | null;
}

export function parseResultEntries(raw: unknown): ResultEntryInput[] {
  const list = asArray(raw, "entries");
  const entries = list.map((item, index) => {
    const entry = asRecord(item, `entries[${index}]`);
    const status = asString(entry.status ?? "ok", `entries[${index}].status`) as RiderStatus;
    if (!VALID_STATUSES.includes(status)) {
      throw badRequest(
        `El estado "${status}" no es válido (usá ${VALID_STATUSES.join(", ")}).`,
      );
    }
    return {
      riderId: asInt(entry.riderId, `entries[${index}].riderId`),
      gate: asInt(entry.gate, `entries[${index}].gate`),
      finishPosition: asInt(entry.finishPosition, `entries[${index}].finishPosition`),
      status,
      replacedRiderId:
        entry.replacedRiderId === undefined || entry.replacedRiderId === null
          ? null
          : asInt(entry.replacedRiderId, `entries[${index}].replacedRiderId`),
    };
  });
  if (entries.length !== 4) {
    throw badRequest("Cada carrera debe tener exactamente 4 pilotos con su posición de llegada.");
  }
  if (!isValidRaceOrder(entries.map((entry) => entry.finishPosition))) {
    throw badRequest(
      "El orden de llegada no es válido: cada piloto necesita una posición de 1 a 4 y sólo puede repetirse en caso de dead heat.",
    );
  }
  if (new Set(entries.map((entry) => entry.gate)).size !== 4) {
    throw badRequest("Las puertas deben ser 4 distintas (1 a 4).");
  }
  if (new Set(entries.map((entry) => entry.riderId)).size !== 4) {
    throw badRequest("Un piloto no puede aparecer dos veces en la misma carrera.");
  }
  return entries;
}

async function validateAgainstRace(
  db: D1Database,
  meetingId: number,
  raceKind: string,
  storedEntries: { rider_id: number; replaced_rider_id: number | null; gate: number | null }[],
  inputs: ResultEntryInput[],
): Promise<void> {
  const reserves = await queryAll<{ rider_id: number }>(
    db,
    "SELECT rider_id FROM meeting_entries WHERE meeting_id = ? AND is_reserve = 1",
    [meetingId],
  );
  const reserveIds = new Set(reserves.map((row) => row.rider_id));
  const scheduledByGate = new Map<number, number>();
  for (const entry of storedEntries) {
    if (entry.gate === null) {
      throw conflict("La carrera todavía no tiene puertas asignadas.");
    }
    scheduledByGate.set(entry.gate, entry.replaced_rider_id ?? entry.rider_id);
  }
  for (const input of inputs) {
    const scheduled = scheduledByGate.get(input.gate);
    if (scheduled === undefined) {
      throw badRequest(`La puerta ${input.gate} no corresponde a esta carrera.`);
    }
    if (input.riderId === scheduled) {
      if (input.replacedRiderId !== null && input.replacedRiderId !== scheduled) {
        throw badRequest("El piloto reemplazado no coincide con el titular de esa puerta.");
      }
      continue;
    }
    if (raceKind === "final") {
      throw badRequest("En la final sólo pueden correr los 4 clasificados.");
    }
    if (!reserveIds.has(input.riderId) || input.replacedRiderId !== scheduled) {
      throw badRequest(
        `En la puerta ${input.gate} sólo puede correr el titular o un reserva que lo reemplace.`,
      );
    }
  }
}

async function replaceRaceEntries(
  db: D1Database,
  raceId: number,
  inputs: ResultEntryInput[],
  withPoints: boolean,
): Promise<void> {
  const points = withPoints
    ? computeHeatPoints(
        inputs.map<HeatResultEntry>((entry) => ({
          riderId: entry.riderId,
          gate: entry.gate,
          finishPosition: entry.finishPosition,
          status: entry.status,
          replacedRiderId: entry.replacedRiderId,
        })),
      )
    : null;
  await execute(db, "DELETE FROM race_entries WHERE race_id = ?", [raceId]);
  await executeBatch(
    db,
    inputs.map((entry) => ({
      sql: `INSERT INTO race_entries
              (race_id, rider_id, replaced_rider_id, gate, finish_position, status, points)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [
        raceId,
        entry.riderId,
        entry.replacedRiderId,
        entry.gate,
        entry.finishPosition,
        entry.status,
        points ? (points.get(entry.riderId) ?? 0) : null,
      ],
    })),
  );
}

async function requireDownstreamConfirmation(
  db: D1Database,
  meetingId: number,
  raceNumbers: number[],
  confirm: boolean,
): Promise<void> {
  const ctx = await loadMeetingContext(db, meetingId);
  const blocking = ctx.races.filter(
    (race) =>
      raceNumbers.includes(race.race_number) &&
      (race.status === "completed" || race.status === "gates_assigned"),
  );
  if (blocking.length > 0 && !confirm) {
    throw conflict(
      `Esta corrección descarta los resultados ya cargados de las carreras ${blocking
        .map((race) => race.race_number)
        .join(", ")}. Reenviá con confirm=true para continuar.`,
      { races: blocking.map((race) => race.race_number) },
    );
  }
}

/**
 * Saves the result of a race (heat, LCQ or final), recalculates the affected
 * classifications and generates the following races. When a correction would
 * discard results of already-run dependent races, `confirm` must be true.
 */
export async function saveRaceResult(
  db: D1Database,
  meetingId: number,
  raceNumber: number,
  inputs: ResultEntryInput[],
  confirm: boolean,
): Promise<void> {
  let ctx = await loadMeetingContext(db, meetingId);
  const race = ctx.races.find((r) => r.race_number === raceNumber);
  if (!race) throw new HttpError(404, "Carrera no encontrada.");
  if (race.kind === "final" && race.status === "pending") {
    throw conflict("Antes de cargar el resultado hay que asignar las puertas de la final.");
  }
  await validateAgainstRace(db, meetingId, race.kind, entriesOfRace(ctx, raceNumber), inputs);
  const affected =
    race.kind === "heat" ? [21, 22, 23] : race.kind === "lcq1" || race.kind === "lcq2" ? [23] : [];
  await requireDownstreamConfirmation(db, meetingId, affected, confirm);
  await replaceRaceEntries(db, race.id, inputs, race.kind === "heat");
  await execute(db, "UPDATE races SET status = 'completed' WHERE id = ?", [race.id]);

  if (race.kind === "heat") {
    ctx = await loadMeetingContext(db, meetingId);
    const intermediate = await recomputeIntermediate(db, ctx);
    await syncRacesFromIntermediate(db, ctx, intermediate);
  } else if (race.kind === "lcq1" || race.kind === "lcq2") {
    await rebuildFinalFromLcqs(db, meetingId);
  }
  ctx = await loadMeetingContext(db, meetingId);
  await recomputeMeetingClassification(db, ctx);
  await recomputeChampionshipAndStats(db);
  await updateMeetingStatus(db, meetingId);
}

/** Assigns the four gate choices of the final (distinct, 1 to 4). */
export async function assignFinalGates(
  db: D1Database,
  meetingId: number,
  raw: unknown,
): Promise<void> {
  const ctx = await loadMeetingContext(db, meetingId);
  const race = ctx.races.find((r) => r.race_number === 23);
  if (!race) throw new HttpError(404, "La final todavía no fue creada.");
  if (race.status === "completed") {
    throw conflict("La final ya tiene resultado cargado; no se pueden cambiar las puertas.");
  }
  const stored = entriesOfRace(ctx, 23);
  const assignments = asArray(raw, "assignments").map((item, index) => {
    const entry = asRecord(item, `assignments[${index}]`);
    return {
      riderId: asInt(entry.riderId, `assignments[${index}].riderId`),
      gate: asInt(entry.gate, `assignments[${index}].gate`),
    };
  });
  if (assignments.length !== 4) throw badRequest("Se deben asignar 4 puertas.");
  if (new Set(assignments.map((a) => a.gate)).size !== 4) {
    throw badRequest("Las puertas deben ser 4 distintas (1 a 4).");
  }
  for (const assignment of assignments) {
    if (![1, 2, 3, 4].includes(assignment.gate)) throw badRequest("Las puertas van de 1 a 4.");
    if (!stored.some((entry) => entry.rider_id === assignment.riderId)) {
      throw badRequest("Todos los pilotos deben ser los 4 clasificados a la final.");
    }
  }
  await executeBatch(
    db,
    assignments.map((assignment) => ({
      sql: "UPDATE race_entries SET gate = ? WHERE race_id = ? AND rider_id = ?",
      params: [assignment.gate, race.id, assignment.riderId],
    })),
  );
  await execute(db, "UPDATE races SET status = 'gates_assigned' WHERE id = ?", [race.id]);
}

/** Resolves a tie flagged as requiring manual resolution. */
export async function resolveIntermediateTie(
  db: D1Database,
  meetingId: number,
  riderIds: number[],
): Promise<void> {
  if (riderIds.length < 2) throw badRequest("Un empate requiere al menos 2 pilotos.");
  const flagged = await queryAll<IntermediateStandingRow>(
    db,
    "SELECT * FROM intermediate_standings WHERE meeting_id = ? AND requires_manual_resolution = 1",
    [meetingId],
  );
  if (flagged.length === 0) {
    throw conflict("No hay empates pendientes de resolución manual.");
  }
  const groups = new Map<number, IntermediateStandingRow[]>();
  for (const row of flagged) {
    const list = groups.get(row.heat_points) ?? [];
    list.push(row);
    groups.set(row.heat_points, list);
  }
  const match = [...groups.values()].find((group) =>
    setEquals(
      group.map((row) => row.rider_id),
      riderIds,
    ),
  );
  if (!match) {
    throw badRequest("Los pilotos indicados no corresponden a un empate pendiente de resolución.");
  }
  await resolveIntermediateInRows(db, meetingId, riderIds);
  const ctx = await loadMeetingContext(db, meetingId);
  const intermediate = await recomputeIntermediate(db, ctx);
  await syncRacesFromIntermediate(db, ctx, intermediate);
  await recomputeMeetingClassification(db, ctx);
  await recomputeChampionshipAndStats(db);
  await updateMeetingStatus(db, meetingId);
}
