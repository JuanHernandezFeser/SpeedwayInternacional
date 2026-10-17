import { Hono } from "hono";
import { asInt, HttpError, notFound } from "./http";
import { queryAll, queryOne } from "./db";
import { getLang, loadTranslations } from "./i18n";
import { applyPublicCache, type AppEnv } from "./middleware";
import { loadMeetingContext } from "./standings";
import {
  riderMap,
  shapeIntermediate,
  shapeMeeting,
  shapeMeetingResults,
  shapeRaces,
  shapeRider,
} from "./serializers";
import type {
  ChampionshipStandingRow,
  IntermediateStandingRow,
  MeetingResultRow,
  MeetingRow,
  RiderRow,
  RiderStatsRow,
} from "./types";

export const publicRoutes = new Hono<AppEnv>();

publicRoutes.get("/photos/:key{.+}", async (c) => {
  const key = c.req.param("key");
  const object = await c.env.PHOTOS.get(key);
  if (!object) throw notFound("Foto no encontrada.");
  c.header("Content-Type", object.httpMetadata?.contentType ?? "image/jpeg");
  return c.body(object.body);
});

publicRoutes.get("/championship", async (c) => {
  const lang = getLang(new URL(c.req.url));
  const standings = await queryAll<ChampionshipStandingRow & { rider_id: number }>(
    c.env.DB,
    "SELECT * FROM championship_standings ORDER BY rank",
  );
  const riderIds = standings.map((row) => row.rider_id);
  const riders = await queryAll<RiderRow>(c.env.DB, "SELECT * FROM riders ORDER BY permanent_number");
  const byId = riderMap(riders);
  const stats = riderIds.length
    ? await queryAll<RiderStatsRow>(
        c.env.DB,
        `SELECT * FROM rider_stats WHERE rider_id IN (${riderIds.map(() => "?").join(", ")})`,
        riderIds,
      )
    : [];
  const statsById = new Map(stats.map((row) => [row.rider_id, row]));
  const translations = await loadTranslations(c.env.DB, "rider", riderIds, lang);
  applyPublicCache(c);
  return c.json({
    standings: standings.map((row) => {
      const rider = byId.get(row.rider_id);
      const stat = statsById.get(row.rider_id);
      return {
        rank: row.rank,
        totalPoints: row.total_points,
        rider: rider ? shapeRider(rider, lang, translations) : null,
        stats: stat
          ? {
              meetingsDisputed: stat.meetings_disputed,
              bestMeetingResult: stat.best_meeting_result,
              heatsRaced: stat.heats_raced,
              heatWins: stat.heat_wins,
              pointsAvg: stat.points_avg,
              finalAppearances: stat.final_appearances,
            }
          : null,
      };
    }),
  });
});

publicRoutes.get("/meetings", async (c) => {
  const lang = getLang(new URL(c.req.url));
  const meetings = await queryAll<MeetingRow>(
    c.env.DB,
    "SELECT * FROM meetings ORDER BY meeting_date DESC",
  );
  const ids = meetings.map((meeting) => meeting.id);
  const translations = await loadTranslations(c.env.DB, "meeting", ids, lang);
  applyPublicCache(c);
  return c.json({
    meetings: meetings.map((meeting) => shapeMeeting(meeting, lang, translations)),
  });
});

publicRoutes.get("/meetings/:id", async (c) => {
  const lang = getLang(new URL(c.req.url));
  const id = asInt(c.req.param("id"), "id");
  const ctx = await loadMeetingContext(c.env.DB, id).catch(() => null);
  if (!ctx) throw new HttpError(404, "Fecha no encontrada.");
  const riders = riderMap(ctx.riders);
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
  const translations = await loadTranslations(c.env.DB, "meeting", [id], lang);
  const riderTranslations = await loadTranslations(
    c.env.DB,
    "rider",
    ctx.entries.map((entry) => entry.rider_id),
    lang,
  );
  applyPublicCache(c, 30, 120);
  return c.json({
    meeting: shapeMeeting(ctx.meeting, lang, translations),
    entries: ctx.entries.map((entry) => {
      const rider = riders.get(entry.rider_id);
      return {
        riderId: entry.rider_id,
        rider: rider ? shapeRider(rider, lang, riderTranslations) : null,
        programNumber: entry.program_number,
        isReserve: entry.is_reserve === 1,
      };
    }),
    races: shapeRaces(ctx, riders, lang, riderTranslations),
    intermediate: shapeIntermediate(intermediate),
    classification: shapeMeetingResults(results),
  });
});

publicRoutes.get("/riders", async (c) => {
  const lang = getLang(new URL(c.req.url));
  const riders = await queryAll<RiderRow>(
    c.env.DB,
    "SELECT * FROM riders WHERE active = 1 ORDER BY permanent_number",
  );
  const ids = riders.map((rider) => rider.id);
  const stats = ids.length
    ? await queryAll<RiderStatsRow>(
        c.env.DB,
        `SELECT * FROM rider_stats WHERE rider_id IN (${ids.map(() => "?").join(", ")})`,
        ids,
      )
    : [];
  const statsById = new Map(stats.map((row) => [row.rider_id, row]));
  const translations = await loadTranslations(c.env.DB, "rider", ids, lang);
  applyPublicCache(c);
  return c.json({
    riders: riders.map((rider) => {
      const stat = statsById.get(rider.id);
      return {
        rider: shapeRider(rider, lang, translations),
        stats: stat
          ? {
              meetingsDisputed: stat.meetings_disputed,
              bestMeetingResult: stat.best_meeting_result,
              heatsRaced: stat.heats_raced,
              heatWins: stat.heat_wins,
              pointsAvg: stat.points_avg,
              finalAppearances: stat.final_appearances,
            }
          : null,
      };
    }),
  });
});

publicRoutes.get("/riders/:id", async (c) => {
  const lang = getLang(new URL(c.req.url));
  const id = asInt(c.req.param("id"), "id");
  const rider = await queryOne<RiderRow>(c.env.DB, "SELECT * FROM riders WHERE id = ?", [id]);
  if (!rider) throw notFound("Piloto no encontrado.");
  const stats = await queryOne<RiderStatsRow>(
    c.env.DB,
    "SELECT * FROM rider_stats WHERE rider_id = ?",
    [id],
  );
  const results = await queryAll<MeetingResultRow & { meeting_name: string; meeting_date: string }>(
    c.env.DB,
    `SELECT mr.*, m.name AS meeting_name, m.meeting_date AS meeting_date
     FROM meeting_results mr JOIN meetings m ON m.id = mr.meeting_id
     WHERE mr.rider_id = ? ORDER BY m.meeting_date DESC`,
    [id],
  );
  const translations = await loadTranslations(c.env.DB, "rider", [id], lang);
  applyPublicCache(c);
  return c.json({
    rider: shapeRider(rider, lang, translations),
    stats: stats
      ? {
          meetingsDisputed: stats.meetings_disputed,
          bestMeetingResult: stats.best_meeting_result,
          heatsRaced: stats.heats_raced,
          heatWins: stats.heat_wins,
          pointsAvg: stats.points_avg,
          finalAppearances: stats.final_appearances,
        }
      : null,
    results: results.map((row) => ({
      meetingId: row.meeting_id,
      meetingName: row.meeting_name,
      meetingDate: row.meeting_date,
      rank: row.rank,
      championshipPoints: row.championship_points,
    })),
  });
});
