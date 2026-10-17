import { describe, expect, it } from "bun:test";
import {
  api,
  createTestDb,
  login,
  makeDrawBody,
  makeEnv,
  seedRiders,
} from "./apiHarness";
import { createSessionToken, SESSION_COOKIE } from "../src/worker/auth";
import type { D1Database, Env } from "../src/worker/types";

interface RaceEntry {
  riderId: number;
  gate: number | null;
  finishPosition: number | null;
  status: string;
}
interface Race {
  raceNumber: number;
  kind: string;
  status: string;
  entries: RaceEntry[];
}
interface MeetingDetail {
  meeting: { status: string };
  races: Race[];
  intermediate: { rows: { rank: number; riderId: number; heatPoints: number }[]; hasBlockedTies: boolean };
  classification: { rank: number; riderId: number; championshipPoints: number }[];
}

async function setup(): Promise<{ env: Env; db: D1Database; cookie: string }> {
  const db = createTestDb();
  await seedRiders(db);
  const env = makeEnv(db);
  const cookie = await login(env);
  return { env, db, cookie };
}

async function createMeeting(env: Env, cookie: string): Promise<number> {
  const response = await api(env, "/api/admin/meetings", {
    method: "POST",
    cookie,
    body: { name: "Fecha 1", meetingDate: "2026-01-10", venue: "Bahía Blanca" },
  });
  const body = (await response.json()) as { id: number };
  return body.id;
}

async function detail(env: Env, cookie: string, id: number): Promise<MeetingDetail> {
  const response = await api(env, `/api/admin/meetings/${id}`, { cookie });
  return (await response.json()) as MeetingDetail;
}

function heatResult(race: Race): RaceEntry[] {
  const positions = new Map<number, number>();
  const sorted = [...race.entries].sort((a, b) => a.riderId - b.riderId);
  sorted.forEach((entry, index) => positions.set(entry.riderId, index + 1));
  if (race.raceNumber === 15) {
    positions.set(16, 1);
    positions.set(3, 2);
    positions.set(10, 3);
    positions.set(5, 4);
  }
  return race.entries.map((entry) => ({
    riderId: entry.riderId,
    gate: entry.gate!,
    finishPosition: positions.get(entry.riderId)!,
    status: "ok",
  }));
}

async function saveResult(
  env: Env,
  cookie: string,
  meetingId: number,
  raceNumber: number,
  entries: RaceEntry[],
  confirm = false,
): Promise<Response> {
  return api(env, `/api/admin/meetings/${meetingId}/races/${raceNumber}/result`, {
    method: "PUT",
    cookie,
    body: { entries, confirm },
  });
}

async function playFullMeeting(env: Env, cookie: string, id: number): Promise<void> {
  let current = await detail(env, cookie, id);
  for (let raceNumber = 1; raceNumber <= 20; raceNumber++) {
    const race = current.races.find((r) => r.raceNumber === raceNumber)!;
    const response = await saveResult(env, cookie, id, raceNumber, heatResult(race));
    expect(response.status).toBe(200);
  }
  current = await detail(env, cookie, id);
  expect(current.races.filter((r) => r.raceNumber === 21 || r.raceNumber === 22).length).toBe(2);
  for (const raceNumber of [21, 22]) {
    const race = current.races.find((r) => r.raceNumber === raceNumber)!;
    const entries = race.entries.map((entry) => ({
      riderId: entry.riderId,
      gate: entry.gate!,
      finishPosition: entry.gate!,
      status: "ok",
    }));
    const response = await saveResult(env, cookie, id, raceNumber, entries);
    expect(response.status).toBe(200);
  }
  current = await detail(env, cookie, id);
  const final = current.races.find((r) => r.raceNumber === 23)!;
  expect(final.entries.map((e) => e.riderId)).toEqual([1, 2, 3, 4]);
  const assignments = final.entries.map((entry, index) => ({
    riderId: entry.riderId,
    gate: index + 1,
  }));
  const gatesResponse = await api(env, `/api/admin/meetings/${id}/final/gates`, {
    method: "PUT",
    cookie,
    body: { assignments },
  });
  expect(gatesResponse.status).toBe(200);
  current = await detail(env, cookie, id);
  const finalWithGates = current.races.find((r) => r.raceNumber === 23)!;
  const finalEntries = finalWithGates.entries.map((entry) => ({
    riderId: entry.riderId,
    gate: entry.gate!,
    finishPosition: entry.gate!,
    status: "ok",
  }));
  const finalResponse = await saveResult(env, cookie, id, 23, finalEntries);
  expect(finalResponse.status).toBe(200);
}

/** Plays all 20 heats and both LCQs, leaving the final pending (no gates). */
async function playToLcqs(env: Env, cookie: string, id: number): Promise<MeetingDetail> {
  let current = await detail(env, cookie, id);
  for (let raceNumber = 1; raceNumber <= 20; raceNumber++) {
    const race = current.races.find((r) => r.raceNumber === raceNumber)!;
    expect((await saveResult(env, cookie, id, raceNumber, heatResult(race))).status).toBe(200);
  }
  current = await detail(env, cookie, id);
  for (const raceNumber of [21, 22]) {
    const race = current.races.find((r) => r.raceNumber === raceNumber)!;
    const entries = race.entries.map((entry) => ({
      riderId: entry.riderId,
      gate: entry.gate!,
      finishPosition: entry.gate!,
      status: "ok",
    }));
    expect((await saveResult(env, cookie, id, raceNumber, entries)).status).toBe(200);
  }
  return detail(env, cookie, id);
}

describe("API de administración", () => {
  it("requiere autenticación", async () => {
    const { env } = await setup();
    const response = await api(env, "/api/admin/riders");
    expect(response.status).toBe(401);
  });

  it("rechaza contraseñas incorrectas y limita los intentos", async () => {
    const { env } = await setup();
    for (let i = 0; i < 5; i++) {
      const response = await api(env, "/api/admin/login", {
        method: "POST",
        body: { password: "mala" },
      });
      expect(response.status).toBe(401);
    }
    const blocked = await api(env, "/api/admin/login", {
      method: "POST",
      body: { password: env.ADMIN_PASSWORD },
    });
    expect(blocked.status).toBe(429);
  });

  it("gestiona pilotos", async () => {
    const { env, cookie } = await setup();
    const created = await api(env, "/api/admin/riders", {
      method: "POST",
      cookie,
      body: { permanentNumber: 757, firstName: "Juan", lastName: "Pérez", countryIso: "ar" },
    });
    expect(created.status).toBe(201);
    const duplicate = await api(env, "/api/admin/riders", {
      method: "POST",
      cookie,
      body: { permanentNumber: 757, firstName: "Otro", lastName: "Pérez", countryIso: "AR" },
    });
    expect(duplicate.status).toBe(409);
  });

  it("confirma el sorteo y genera los 20 heats", async () => {
    const { env, cookie } = await setup();
    const id = await createMeeting(env, cookie);
    const response = await api(env, `/api/admin/meetings/${id}/draw/confirm`, {
      method: "POST",
      cookie,
      body: makeDrawBody(),
    });
    expect(response.status).toBe(200);
    const current = await detail(env, cookie, id);
    expect(current.races.length).toBe(20);
    const heat5 = current.races.find((r) => r.raceNumber === 5)!;
    expect(heat5.entries.map((e) => e.riderId)).toEqual([13, 1, 5, 9]);
    expect(heat5.entries.map((e) => e.gate)).toEqual([1, 2, 3, 4]);
  });

  it("calcula la intermedia, crea LCQs y la final, y la clasificación de la fecha", async () => {
    const { env, cookie } = await setup();
    const id = await createMeeting(env, cookie);
    await api(env, `/api/admin/meetings/${id}/draw/confirm`, {
      method: "POST",
      cookie,
      body: makeDrawBody(),
    });
    await playFullMeeting(env, cookie, id);

    const current = await detail(env, cookie, id);
    expect(current.meeting.status).toBe("completed");
    expect(current.intermediate.hasBlockedTies).toBe(false);
    expect(current.intermediate.rows.map((row) => row.riderId).slice(0, 4)).toEqual([1, 2, 3, 4]);
    expect(current.classification.map((row) => row.riderId)).toEqual([
      1, 2, 3, 4, 6, 5, 7, 8, 9, 10, 11, 12, 13, 16, 14, 15, 17, 18,
    ]);
    expect(current.classification.find((row) => row.rank === 1)!.championshipPoints).toBe(20);
  });

  it("genera la tabla del campeonato al terminar una fecha", async () => {
    const { env, cookie } = await setup();
    const id = await createMeeting(env, cookie);
    await api(env, `/api/admin/meetings/${id}/draw/confirm`, {
      method: "POST",
      cookie,
      body: makeDrawBody(),
    });
    await playFullMeeting(env, cookie, id);

    const response = await api(env, "/api/championship");
    const body = (await response.json()) as {
      standings: { rank: number; totalPoints: number; rider: { id: number } }[];
    };
    expect(body.standings[0]!.rider.id).toBe(1);
    expect(body.standings[0]!.totalPoints).toBe(20);
    expect(body.standings.length).toBe(18);
  });

  it("pide confirmación antes de descartar resultados al corregir un heat", async () => {
    const { env, cookie } = await setup();
    const id = await createMeeting(env, cookie);
    await api(env, `/api/admin/meetings/${id}/draw/confirm`, {
      method: "POST",
      cookie,
      body: makeDrawBody(),
    });
    await playFullMeeting(env, cookie, id);

    let current = await detail(env, cookie, id);
    const heat1 = current.races.find((r) => r.raceNumber === 1)!;
    const reversed = heat1.entries.map((entry) => ({
      riderId: entry.riderId,
      gate: entry.gate!,
      finishPosition: 5 - entry.finishPosition!,
      status: "ok",
    }));
    const withoutConfirm = await saveResult(env, cookie, id, 1, reversed, false);
    expect(withoutConfirm.status).toBe(409);

    const withConfirm = await saveResult(env, cookie, id, 1, reversed, true);
    expect(withConfirm.status).toBe(200);
    current = await detail(env, cookie, id);
    expect(current.races.find((r) => r.raceNumber === 23)).toBeUndefined();
    expect(current.races.filter((r) => r.raceNumber >= 21).length).toBe(2);
  });

  it("reparte puntos en dead heat y persiste medios puntos", async () => {
    const { env, db, cookie } = await setup();
    const id = await createMeeting(env, cookie);
    await api(env, `/api/admin/meetings/${id}/draw/confirm`, {
      method: "POST",
      cookie,
      body: makeDrawBody(),
    });
    const current = await detail(env, cookie, id);
    const heat1 = current.races.find((r) => r.raceNumber === 1)!;
    const order = heat1.entries.map((entry) => entry.riderId);
    const entries = [
      { riderId: order[0]!, gate: 1, finishPosition: 1, status: "ok" },
      { riderId: order[1]!, gate: 2, finishPosition: 1, status: "ok" },
      { riderId: order[2]!, gate: 3, finishPosition: 3, status: "ok" },
      { riderId: order[3]!, gate: 4, finishPosition: 4, status: "ok" },
    ];
    const response = await saveResult(env, cookie, id, 1, entries);
    expect(response.status).toBe(200);
    const { results: points } = await db
      .prepare(
        "SELECT re.rider_id AS riderId, re.points AS points FROM race_entries re JOIN races r ON r.id = re.race_id WHERE r.meeting_id = ? AND r.race_number = 1 ORDER BY re.points DESC",
      )
      .bind(id)
      .all<{ riderId: number; points: number }>();
    expect(points[0]!.points).toBe(2.5);
    expect(points[1]!.points).toBe(2.5);
  });

  it("resuelve manualmente un empate sin criterio antes de generar las LCQ", async () => {
    const { env, cookie } = await setup();
    const id = await createMeeting(env, cookie);
    await api(env, `/api/admin/meetings/${id}/draw/confirm`, {
      method: "POST",
      cookie,
      body: makeDrawBody(),
    });
    let current = await detail(env, cookie, id);
    for (let raceNumber = 1; raceNumber <= 20; raceNumber++) {
      const race = current.races.find((r) => r.raceNumber === raceNumber)!;
      const entries =
        raceNumber === 1
          ? [
              { riderId: 1, gate: 1, finishPosition: 1, status: "ok" },
              { riderId: 2, gate: 2, finishPosition: 1, status: "ok" },
              { riderId: 3, gate: 3, finishPosition: 3, status: "ok" },
              { riderId: 4, gate: 4, finishPosition: 4, status: "ok" },
            ]
          : heatResult(race);
      expect((await saveResult(env, cookie, id, raceNumber, entries)).status).toBe(200);
    }
    current = await detail(env, cookie, id);
    expect(current.intermediate.hasBlockedTies).toBe(true);
    expect(current.races.filter((r) => r.raceNumber >= 21).length).toBe(0);

    const resolved = await api(env, `/api/admin/meetings/${id}/resolve-tie`, {
      method: "POST",
      cookie,
      body: { riderIds: [2, 1] },
    });
    expect(resolved.status).toBe(200);
    current = await detail(env, cookie, id);
    expect(current.intermediate.hasBlockedTies).toBe(false);
    expect(current.intermediate.rows[0]!.riderId).toBe(2);
    expect(current.races.filter((r) => r.raceNumber === 21 || r.raceNumber === 22).length).toBe(2);

    const again = await api(env, `/api/admin/meetings/${id}/resolve-tie`, {
      method: "POST",
      cookie,
      body: { riderIds: [1, 2] },
    });
    expect(again.status).toBe(409);
  });

  it("bloquea el sorteo cuando la fecha ya tiene resultados", async () => {
    const { env, cookie } = await setup();
    const id = await createMeeting(env, cookie);
    await api(env, `/api/admin/meetings/${id}/draw/confirm`, {
      method: "POST",
      cookie,
      body: makeDrawBody(),
    });
    const current = await detail(env, cookie, id);
    const heat1 = current.races.find((r) => r.raceNumber === 1)!;
    await saveResult(env, cookie, id, 1, heatResult(heat1));
    const response = await api(env, `/api/admin/meetings/${id}/draw`, {
      method: "PUT",
      cookie,
      body: makeDrawBody(),
    });
    expect(response.status).toBe(409);
  });

  it("la final rechaza el resultado hasta asignar 4 puertas distintas", async () => {
    const { env, cookie } = await setup();
    const id = await createMeeting(env, cookie);
    await api(env, `/api/admin/meetings/${id}/draw/confirm`, {
      method: "POST",
      cookie,
      body: makeDrawBody(),
    });
    let current = await playToLcqs(env, cookie, id);
    const final = current.races.find((r) => r.raceNumber === 23)!;
    expect(final.status).toBe("pending");
    expect(final.entries.every((entry) => entry.gate === null)).toBe(true);

    // A result with gates 1-4 but without gates assigned in the race: 409.
    const early = final.entries.map((entry, index) => ({
      riderId: entry.riderId,
      gate: index + 1,
      finishPosition: index + 1,
      status: "ok",
    }));
    expect((await saveResult(env, cookie, id, 23, early)).status).toBe(409);

    const gatesUrl = `/api/admin/meetings/${id}/final/gates`;
    const repeated = [
      { riderId: final.entries[0]!.riderId, gate: 1 },
      { riderId: final.entries[1]!.riderId, gate: 1 },
      { riderId: final.entries[2]!.riderId, gate: 2 },
      { riderId: final.entries[3]!.riderId, gate: 3 },
    ];
    const repeatedRes = await api(env, gatesUrl, {
      method: "PUT",
      cookie,
      body: { assignments: repeated },
    });
    expect(repeatedRes.status).toBe(400);

    const outOfRange = [
      { riderId: final.entries[0]!.riderId, gate: 1 },
      { riderId: final.entries[1]!.riderId, gate: 2 },
      { riderId: final.entries[2]!.riderId, gate: 3 },
      { riderId: final.entries[3]!.riderId, gate: 5 },
    ];
    const outOfRangeRes = await api(env, gatesUrl, {
      method: "PUT",
      cookie,
      body: { assignments: outOfRange },
    });
    expect(outOfRangeRes.status).toBe(400);

    const valid = final.entries.map((entry, index) => ({
      riderId: entry.riderId,
      gate: index + 1,
    }));
    const validRes = await api(env, gatesUrl, {
      method: "PUT",
      cookie,
      body: { assignments: valid },
    });
    expect(validRes.status).toBe(200);

    current = await detail(env, cookie, id);
    const withGates = current.races.find((r) => r.raceNumber === 23)!;
    expect(withGates.status).toBe("gates_assigned");
    expect(withGates.entries.map((entry) => entry.gate)).toEqual([1, 2, 3, 4]);

    const entries = withGates.entries.map((entry) => ({
      riderId: entry.riderId,
      gate: entry.gate!,
      finishPosition: entry.gate!,
      status: "ok",
    }));
    expect((await saveResult(env, cookie, id, 23, entries)).status).toBe(200);
  });

  it("rechaza resultados con posición faltante o menos de 4 pilotos sin modificar nada", async () => {
    const { env, db, cookie } = await setup();
    const id = await createMeeting(env, cookie);
    await api(env, `/api/admin/meetings/${id}/draw/confirm`, {
      method: "POST",
      cookie,
      body: makeDrawBody(),
    });
    const current = await detail(env, cookie, id);
    const heat1 = current.races.find((r) => r.raceNumber === 1)!;
    const url = `/api/admin/meetings/${id}/races/1/result`;

    const missing = heat1.entries.map((entry, index) => ({
      riderId: entry.riderId,
      gate: entry.gate!,
      finishPosition: index === 0 ? undefined : index + 1,
      status: "ok",
    }));
    const missingRes = await api(env, url, { method: "PUT", cookie, body: { entries: missing } });
    expect(missingRes.status).toBe(400);

    const three = heat1.entries.slice(0, 3).map((entry, index) => ({
      riderId: entry.riderId,
      gate: entry.gate!,
      finishPosition: index + 1,
      status: "ok",
    }));
    const threeRes = await api(env, url, { method: "PUT", cookie, body: { entries: three } });
    expect(threeRes.status).toBe(400);

    const raceRow = await db
      .prepare("SELECT id, status FROM races WHERE meeting_id = ? AND race_number = 1")
      .bind(id)
      .first<{ id: number; status: string }>();
    expect(raceRow!.status).toBe("pending");
    const { results: stored } = await db
      .prepare("SELECT finish_position AS fp, status FROM race_entries WHERE race_id = ?")
      .bind(raceRow!.id)
      .all<{ fp: number | null; status: string }>();
    expect(stored.length).toBe(4);
    expect(stored.every((entry) => entry.fp === null && entry.status === "ok")).toBe(true);
  });

  it("desactiva pilotos que participaron y borra los que no", async () => {
    const { env, db, cookie } = await setup();
    const id = await createMeeting(env, cookie);
    await api(env, `/api/admin/meetings/${id}/draw/confirm`, {
      method: "POST",
      cookie,
      body: makeDrawBody(),
    });
    const deactivated = await api(env, "/api/admin/riders/1", { method: "DELETE", cookie });
    expect(deactivated.status).toBe(200);
    const deactivatedBody = (await deactivated.json()) as { deactivated?: boolean };
    expect(deactivatedBody.deactivated).toBe(true);
    const kept = await db
      .prepare("SELECT active FROM riders WHERE id = 1")
      .first<{ active: number }>();
    expect(kept!.active).toBe(0);

    const created = await api(env, "/api/admin/riders", {
      method: "POST",
      cookie,
      body: { permanentNumber: 9999, firstName: "Nuevo", lastName: "Piloto", countryIso: "AR" },
    });
    const newId = ((await created.json()) as { id: number }).id;
    const removed = await api(env, `/api/admin/riders/${newId}`, { method: "DELETE", cookie });
    expect(removed.status).toBe(200);
    const removedBody = (await removed.json()) as { deleted?: boolean };
    expect(removedBody.deleted).toBe(true);
    const gone = await db
      .prepare("SELECT COUNT(*) AS count FROM riders WHERE id = ?")
      .bind(newId)
      .first<{ count: number }>();
    expect(gone!.count).toBe(0);
  });

  it("no borra una fecha con resultados pero sí una sin resultados", async () => {
    const { env, cookie } = await setup();
    const withResults = await createMeeting(env, cookie);
    await api(env, `/api/admin/meetings/${withResults}/draw/confirm`, {
      method: "POST",
      cookie,
      body: makeDrawBody(),
    });
    const current = await detail(env, cookie, withResults);
    const heat1 = current.races.find((r) => r.raceNumber === 1)!;
    await saveResult(env, cookie, withResults, 1, heatResult(heat1));
    const blocked = await api(env, `/api/admin/meetings/${withResults}`, {
      method: "DELETE",
      cookie,
    });
    expect(blocked.status).toBe(409);

    const empty = await createMeeting(env, cookie);
    const deleted = await api(env, `/api/admin/meetings/${empty}`, { method: "DELETE", cookie });
    expect(deleted.status).toBe(200);
    const gone = await api(env, `/api/admin/meetings/${empty}`, { cookie });
    expect(gone.status).toBe(404);
  });
});

describe("Sesión", () => {
  it("rechaza una cookie vencida y una con firma alterada", async () => {
    const { env, cookie } = await setup();
    const [name, token] = cookie.split("=") as [string, string];
    const [expires, signature] = token.split(".") as [string, string];

    // Valid signature but expired (issued more than 8 hours ago).
    const expired = await createSessionToken(env, Date.now() - 9 * 60 * 60 * 1000);
    const expiredRes = await api(env, "/api/admin/riders", {
      cookie: `${SESSION_COOKIE}=${expired}`,
    });
    expect(expiredRes.status).toBe(401);

    // Same signature, different expiration -> signature no longer matches.
    const tampered = `${name}=${Number(expires) + 100000}.${signature}`;
    const tamperedRes = await api(env, "/api/admin/riders", { cookie: tampered });
    expect(tamperedRes.status).toBe(401);

    // Sanity check: the original cookie still works.
    const validRes = await api(env, "/api/admin/riders", { cookie });
    expect(validRes.status).toBe(200);
  });
});

describe("API pública", () => {
  it("expone posiciones, fechas y pilotos en el idioma pedido", async () => {
    const { env } = await setup();
    const riders = await (await api(env, "/api/riders?lang=en")).json();
    expect((riders as { riders: unknown[] }).riders.length).toBe(18);
    const meetings = await (await api(env, "/api/meetings")).json();
    expect((meetings as { meetings: unknown[] }).meetings.length).toBe(0);
  });

  it("sirve la ficha de una fecha con sus carreras", async () => {
    const { env, cookie } = await setup();
    const id = await createMeeting(env, cookie);
    await api(env, `/api/admin/meetings/${id}/draw/confirm`, {
      method: "POST",
      cookie,
      body: makeDrawBody(),
    });
    const response = await api(env, `/api/meetings/${id}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { races: Race[] };
    expect(body.races.length).toBe(20);
    const missing = await api(env, "/api/meetings/999");
    expect(missing.status).toBe(404);
  });

  it("sirve una fecha recién creada sin sorteo", async () => {
    const { env, cookie } = await setup();
    const id = await createMeeting(env, cookie);
    const response = await api(env, `/api/meetings/${id}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as MeetingDetail;
    expect(body.races).toEqual([]);
    expect(body.intermediate.rows).toEqual([]);
    expect(body.classification).toEqual([]);
  });

  it("sirve una fecha en curso con carreras pendientes y clasificación parcial coherente", async () => {
    const { env, cookie } = await setup();
    const id = await createMeeting(env, cookie);
    await api(env, `/api/admin/meetings/${id}/draw/confirm`, {
      method: "POST",
      cookie,
      body: makeDrawBody(),
    });
    const current = await detail(env, cookie, id);
    for (const raceNumber of [1, 2, 3]) {
      const race = current.races.find((r) => r.raceNumber === raceNumber)!;
      expect((await saveResult(env, cookie, id, raceNumber, heatResult(race))).status).toBe(200);
    }
    const response = await api(env, `/api/meetings/${id}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as MeetingDetail;
    expect(body.races.length).toBe(20);
    expect(body.races.filter((r) => r.status === "completed").length).toBe(3);
    expect(body.races.filter((r) => r.status === "pending").length).toBe(17);
    expect(body.intermediate.rows).toEqual([]);
    expect(body.classification).toEqual([]);
  });
});

describe("Fotos y traducciones", () => {
  it("sube una foto a R2 y la sirve públicamente", async () => {
    const { env, cookie } = await setup();
    const bytes = new TextEncoder().encode("foto-falsa").buffer;
    const upload = await api(env, "/api/admin/riders/1/photo", {
      method: "POST",
      cookie,
      rawBody: bytes,
      headers: { "content-type": "image/png" },
    });
    expect(upload.status).toBe(200);
    const { photoKey } = (await upload.json()) as { photoKey: string };
    expect(photoKey).toBe("riders/1.png");
    const photo = await api(env, "/api/photos/riders/1.png");
    expect(photo.status).toBe(200);
    expect(photo.headers.get("content-type")).toBe("image/png");
  });

  it("guarda y aplica traducciones con texto de respaldo en español", async () => {
    const { env, cookie } = await setup();
    const id = await createMeeting(env, cookie);
    const save = await api(env, "/api/admin/translations", {
      method: "PUT",
      cookie,
      body: { entity: "meeting", entityId: id, field: "name", lang: "en", text: "Round 1" },
    });
    expect(save.status).toBe(200);
    const list = await api(env, `/api/admin/translations?entity=meeting&entityId=${id}`, { cookie });
    const body = (await list.json()) as { translations: { source_hash: string | null }[] };
    expect(body.translations.length).toBe(1);
    expect(body.translations[0]!.source_hash).not.toBeNull();

    const english = await (await api(env, "/api/meetings?lang=en")).json();
    expect((english as { meetings: { name: string }[] }).meetings[0]!.name).toBe("Round 1");
    const spanish = await (await api(env, "/api/meetings?lang=es")).json();
    expect((spanish as { meetings: { name: string }[] }).meetings[0]!.name).toBe("Fecha 1");
    const polish = await (await api(env, "/api/meetings?lang=pl")).json();
    expect((polish as { meetings: { name: string }[] }).meetings[0]!.name).toBe("Fecha 1");
  });
});
