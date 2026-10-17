import { Hono } from "hono";
import {
  asInt,
  asRecord,
  asString,
  asArray,
  badRequest,
  conflict,
  HttpError,
  readJson,
} from "./http";
import { execute, queryAll, queryOne } from "./db";
import {
  clearLoginAttempts,
  clearSessionCookieHeader,
  createSessionToken,
  loginAllowed,
  parseIntCookie,
  registerFailedLogin,
  sessionCookieHeader,
  verifySessionToken,
  SESSION_COOKIE,
} from "./auth";
import { hashText, spanishSourceText, TRANSLATABLE_FIELDS, isSupportedLang } from "./i18n";
import { requireAdmin, type AppEnv } from "./middleware";
import { loadMeetingContext, type MeetingContext } from "./standings";
import {
  shapeIntermediate,
  shapeMeetingResults,
  shapeMeeting,
  shapeRaces,
  riderMap,
} from "./serializers";
import type {
  IntermediateStandingRow,
  MeetingResultRow,
  RiderRow,
} from "./types";
import {
  assignFinalGates,
  confirmDraw,
  parseDrawInput,
  parseResultEntries,
  redoDraw,
  resolveIntermediateTie,
  saveDraw,
  saveRaceResult,
} from "./meetings";

export const adminRoutes = new Hono<AppEnv>();

function intParam(c: { req: { param: (name: string) => string | undefined } }, name: string): number {
  return asInt(c.req.param(name), name);
}

async function requireRider(db: AppEnv["Bindings"]["DB"], id: number): Promise<RiderRow> {
  const rider = await queryOne<RiderRow>(db, "SELECT * FROM riders WHERE id = ?", [id]);
  if (!rider) throw new HttpError(404, "Piloto no encontrado.");
  return rider;
}

async function ensureMeeting(ctx: MeetingContext | null, id: number): Promise<void> {
  if (!ctx) throw new HttpError(404, `La fecha ${id} no existe.`);
}

/* ------------------------------- auth --------------------------------- */

adminRoutes.post("/login", async (c) => {
  const body = asRecord(await readJson<unknown>(c), "body");
  const password = asString(body.password, "password");
  const ip =
    c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "local";
  const now = Date.now();
  if (!(await loginAllowed(c.env.DB, ip, now))) {
    throw new HttpError(429, "Demasiados intentos fallidos. Probá más tarde.");
  }
  if (password !== c.env.ADMIN_PASSWORD) {
    await registerFailedLogin(c.env.DB, ip, now);
    throw new HttpError(401, "Contraseña incorrecta.");
  }
  await clearLoginAttempts(c.env.DB, ip);
  const token = await createSessionToken(c.env, now);
  c.header("Set-Cookie", sessionCookieHeader(token));
  return c.json({ ok: true });
});

adminRoutes.post("/logout", (c) => {
  c.header("Set-Cookie", clearSessionCookieHeader());
  return c.json({ ok: true });
});

adminRoutes.get("/session", async (c) => {
  const token = parseIntCookie(c.req.header("cookie"), SESSION_COOKIE);
  const authenticated = !!token && (await verifySessionToken(c.env, token, Date.now()));
  return c.json({ authenticated });
});

adminRoutes.use("*", requireAdmin);

/* ------------------------------- riders ------------------------------- */

adminRoutes.get("/riders", async (c) => {
  const riders = await queryAll<RiderRow>(c.env.DB, "SELECT * FROM riders ORDER BY permanent_number");
  return c.json({ riders });
});

adminRoutes.post("/riders", async (c) => {
  const body = asRecord(await readJson<unknown>(c), "body");
  const permanentNumber = asInt(body.permanentNumber, "permanentNumber");
  const firstName = asString(body.firstName, "firstName");
  const lastName = asString(body.lastName, "lastName");
  const countryIso = asString(body.countryIso, "countryIso").toUpperCase();
  const existing = await queryOne<{ id: number }>(
    c.env.DB,
    "SELECT id FROM riders WHERE permanent_number = ?",
    [permanentNumber],
  );
  if (existing) throw conflict(`El número permanente ${permanentNumber} ya está en uso.`);
  const result = await c.env.DB.prepare(
    `INSERT INTO riders (permanent_number, first_name, last_name, country_iso)
     VALUES (?, ?, ?, ?)`,
  )
    .bind(permanentNumber, firstName, lastName, countryIso)
    .run();
  return c.json({ id: result.meta.last_row_id ?? 0 }, 201);
});

adminRoutes.put("/riders/:id", async (c) => {
  const id = intParam(c, "id");
  await requireRider(c.env.DB, id);
  const body = asRecord(await readJson<unknown>(c), "body");
  const firstName = asString(body.firstName, "firstName");
  const lastName = asString(body.lastName, "lastName");
  const countryIso = asString(body.countryIso, "countryIso").toUpperCase();
  const permanentNumber = asInt(body.permanentNumber, "permanentNumber");
  const clash = await queryOne<{ id: number }>(
    c.env.DB,
    "SELECT id FROM riders WHERE permanent_number = ? AND id <> ?",
    [permanentNumber, id],
  );
  if (clash) throw conflict(`El número permanente ${permanentNumber} ya está en uso.`);
  const active = body.active === undefined ? true : body.active === true || body.active === 1;
  await execute(
    c.env.DB,
    `UPDATE riders SET permanent_number = ?, first_name = ?, last_name = ?,
       country_iso = ?, active = ?, updated_at = datetime('now') WHERE id = ?`,
    [permanentNumber, firstName, lastName, countryIso, active ? 1 : 0, id],
  );
  return c.json({ ok: true });
});

adminRoutes.delete("/riders/:id", async (c) => {
  const id = intParam(c, "id");
  await requireRider(c.env.DB, id);
  const used = await queryOne<{ count: number }>(
    c.env.DB,
    "SELECT COUNT(*) AS count FROM meeting_entries WHERE rider_id = ?",
    [id],
  );
  if ((used?.count ?? 0) > 0) {
    await execute(c.env.DB, "UPDATE riders SET active = 0 WHERE id = ?", [id]);
    return c.json({ deactivated: true });
  }
  await execute(c.env.DB, "DELETE FROM riders WHERE id = ?", [id]);
  return c.json({ deleted: true });
});

adminRoutes.post("/riders/:id/photo", async (c) => {
  const id = intParam(c, "id");
  await requireRider(c.env.DB, id);
  const contentType = c.req.header("content-type") ?? "application/octet-stream";
  if (!contentType.startsWith("image/")) {
    throw badRequest("La foto debe ser una imagen (image/*).");
  }
  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) throw badRequest("La foto está vacía.");
  const extension = contentType.includes("png")
    ? "png"
    : contentType.includes("webp")
      ? "webp"
      : "jpg";
  const key = `riders/${id}.${extension}`;
  await c.env.PHOTOS.put(key, body, { httpMetadata: { contentType } });
  await execute(c.env.DB, "UPDATE riders SET photo_key = ?, updated_at = datetime('now') WHERE id = ?", [
    key,
    id,
  ]);
  return c.json({ photoKey: key });
});

/* ------------------------------ meetings ------------------------------ */

adminRoutes.get("/meetings", async (c) => {
  const meetings = await queryAll(
    c.env.DB,
    "SELECT id, name, meeting_date, venue, status, created_at, updated_at FROM meetings ORDER BY meeting_date DESC",
  );
  return c.json({ meetings });
});

adminRoutes.post("/meetings", async (c) => {
  const body = asRecord(await readJson<unknown>(c), "body");
  const name = asString(body.name, "name");
  const meetingDate = asString(body.meetingDate, "meetingDate");
  const venue = asString(body.venue, "venue");
  const result = await c.env.DB.prepare(
    "INSERT INTO meetings (name, meeting_date, venue) VALUES (?, ?, ?)",
  )
    .bind(name, meetingDate, venue)
    .run();
  return c.json({ id: result.meta.last_row_id ?? 0 }, 201);
});

adminRoutes.put("/meetings/:id", async (c) => {
  const id = intParam(c, "id");
  const existing = await queryOne<{ id: number }>(c.env.DB, "SELECT id FROM meetings WHERE id = ?", [
    id,
  ]);
  if (!existing) throw new HttpError(404, "Fecha no encontrada.");
  const body = asRecord(await readJson<unknown>(c), "body");
  const name = asString(body.name, "name");
  const meetingDate = asString(body.meetingDate, "meetingDate");
  const venue = asString(body.venue, "venue");
  await execute(
    c.env.DB,
    "UPDATE meetings SET name = ?, meeting_date = ?, venue = ?, updated_at = datetime('now') WHERE id = ?",
    [name, meetingDate, venue, id],
  );
  return c.json({ ok: true });
});

adminRoutes.delete("/meetings/:id", async (c) => {
  const id = intParam(c, "id");
  const results = await queryOne<{ count: number }>(
    c.env.DB,
    "SELECT COUNT(*) AS count FROM races WHERE meeting_id = ? AND status = 'completed'",
    [id],
  );
  if ((results?.count ?? 0) > 0) {
    throw conflict("La fecha tiene resultados cargados; no se puede borrar.");
  }
  await execute(c.env.DB, "DELETE FROM meetings WHERE id = ?", [id]);
  return c.json({ deleted: true });
});

adminRoutes.get("/meetings/:id", async (c) => {
  const id = intParam(c, "id");
  const ctx = await loadMeetingContext(c.env.DB, id).catch(() => null);
  await ensureMeeting(ctx, id);
  const riders = riderMap(ctx!.riders);
  const intermediate = await queryAll<IntermediateStandingRow>(
    c.env.DB,
    "SELECT * FROM intermediate_standings WHERE meeting_id = ? ORDER BY rank",
    [id],
  );
  const results = await queryAll<MeetingResultRow>(
    c.env.DB,
    "SELECT * FROM meeting_results WHERE meeting_id = ? ORDER BY rank",
    [id],
  );
  const emptyTranslations = new Map<string, string>();
  return c.json({
    meeting: shapeMeeting(ctx!.meeting, "es", emptyTranslations),
    entries: ctx!.entries.map((entry) => ({
      riderId: entry.rider_id,
      programNumber: entry.program_number,
      isReserve: entry.is_reserve === 1,
    })),
    races: shapeRaces(ctx!, riders, "es", emptyTranslations),
    intermediate: shapeIntermediate(intermediate),
    classification: shapeMeetingResults(results),
  });
});

adminRoutes.get("/meetings/:id/draw", async (c) => {
  const id = intParam(c, "id");
  const ctx = await loadMeetingContext(c.env.DB, id).catch(() => null);
  await ensureMeeting(ctx, id);
  return c.json({
    titulares: ctx!.entries
      .filter((entry) => entry.is_reserve === 0 && entry.program_number !== null)
      .map((entry) => ({ riderId: entry.rider_id, programNumber: entry.program_number })),
    reserves: ctx!.entries.filter((entry) => entry.is_reserve === 1).map((entry) => entry.rider_id),
  });
});

adminRoutes.put("/meetings/:id/draw", async (c) => {
  const id = intParam(c, "id");
  const draw = parseDrawInput(await readJson<unknown>(c));
  await saveDraw(c.env.DB, id, draw);
  return c.json({ ok: true });
});

adminRoutes.post("/meetings/:id/draw/confirm", async (c) => {
  const id = intParam(c, "id");
  const draw = parseDrawInput(await readJson<unknown>(c));
  await confirmDraw(c.env.DB, id, draw);
  return c.json({ ok: true });
});

adminRoutes.post("/meetings/:id/draw/redo", async (c) => {
  const id = intParam(c, "id");
  const body = asRecord(await readJson<unknown>(c), "body");
  await redoDraw(c.env.DB, id, body.confirm === true);
  return c.json({ ok: true });
});

adminRoutes.put("/meetings/:id/races/:raceNumber/result", async (c) => {
  const id = intParam(c, "id");
  const raceNumber = intParam(c, "raceNumber");
  const body = asRecord(await readJson<unknown>(c), "body");
  const entries = parseResultEntries(body.entries);
  await saveRaceResult(c.env.DB, id, raceNumber, entries, body.confirm === true);
  return c.json({ ok: true });
});

adminRoutes.put("/meetings/:id/final/gates", async (c) => {
  const id = intParam(c, "id");
  const body = asRecord(await readJson<unknown>(c), "body");
  await assignFinalGates(c.env.DB, id, body.assignments);
  return c.json({ ok: true });
});

adminRoutes.post("/meetings/:id/resolve-tie", async (c) => {
  const id = intParam(c, "id");
  const body = asRecord(await readJson<unknown>(c), "body");
  const riderIds = asArray(body.riderIds, "riderIds").map((value, index) =>
    asInt(value, `riderIds[${index}]`),
  );
  await resolveIntermediateTie(c.env.DB, id, riderIds);
  return c.json({ ok: true });
});

/* ---------------------------- translations ---------------------------- */

adminRoutes.get("/translations", async (c) => {
  const entity = asString(c.req.query("entity"), "entity");
  const entityId = asInt(c.req.query("entityId"), "entityId");
  if (!TRANSLATABLE_FIELDS[entity]) throw badRequest(`Entidad desconocida: ${entity}.`);
  const rows = await queryAll(
    c.env.DB,
    "SELECT entity, entity_id, field, lang, text, source_hash FROM translations WHERE entity = ? AND entity_id = ?",
    [entity, entityId],
  );
  return c.json({ translations: rows });
});

adminRoutes.put("/translations", async (c) => {
  const body = asRecord(await readJson<unknown>(c), "body");
  const entity = asString(body.entity, "entity");
  const field = asString(body.field, "field");
  const lang = asString(body.lang, "lang");
  const entityId = asInt(body.entityId, "entityId");
  if (!TRANSLATABLE_FIELDS[entity]?.includes(field)) {
    throw badRequest(`El campo "${field}" no es traducible para ${entity}.`);
  }
  if (!isSupportedLang(lang)) throw badRequest("Idioma no soportado (es, en, pl).");
  const text = asString(body.text, "text");
  const source = await spanishSourceText(c.env.DB, entity, entityId, field);
  const sourceHash = source === null ? null : await hashText(source);
  await execute(
    c.env.DB,
    `INSERT INTO translations (entity, entity_id, field, lang, text, source_hash, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT (entity, entity_id, field, lang)
     DO UPDATE SET text = excluded.text, source_hash = excluded.source_hash, updated_at = datetime('now')`,
    [entity, entityId, field, lang, text, sourceHash],
  );
  return c.json({ ok: true });
});
