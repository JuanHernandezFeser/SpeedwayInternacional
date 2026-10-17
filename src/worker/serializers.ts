import { translated, type Lang } from "./i18n";
import type { MeetingContext } from "./standings";
import type { IntermediateStandingRow, MeetingResultRow, RiderRow } from "./types";

export interface RiderShape {
  id: number;
  permanentNumber: number;
  firstName: string;
  lastName: string;
  countryIso: string;
  photoKey: string | null;
  active: boolean;
}

export interface MeetingShape {
  id: number;
  name: string;
  meetingDate: string;
  venue: string;
  status: string;
}

export function riderMap(riders: RiderRow[]): Map<number, RiderRow> {
  return new Map(riders.map((rider) => [rider.id, rider]));
}

export function shapeRider(
  rider: RiderRow,
  lang: Lang,
  translations: Map<string, string>,
): RiderShape {
  return {
    id: rider.id,
    permanentNumber: rider.permanent_number,
    firstName: translated(translations, rider.id, "first_name", rider.first_name),
    lastName: translated(translations, rider.id, "last_name", rider.last_name),
    countryIso: rider.country_iso,
    photoKey: rider.photo_key,
    active: rider.active === 1,
  };
}

export function shapeMeeting(
  meeting: MeetingContext["meeting"],
  lang: Lang,
  translations: Map<string, string>,
): MeetingShape {
  return {
    id: meeting.id,
    name: translated(translations, meeting.id, "name", meeting.name),
    meetingDate: meeting.meeting_date,
    venue: translated(translations, meeting.id, "venue", meeting.venue),
    status: meeting.status,
  };
}

export interface RaceEntryShape {
  riderId: number;
  rider: RiderShape | null;
  programNumber: number | null;
  replacedRiderId: number | null;
  gate: number | null;
  finishPosition: number | null;
  status: string;
  points: number | null;
}

export function shapeRaceEntries(
  ctx: MeetingContext,
  raceId: number,
  riders: Map<number, RiderRow>,
  lang: Lang,
  translations: Map<string, string>,
): RaceEntryShape[] {
  return ctx.raceEntries
    .filter((entry) => entry.race_id === raceId)
    .map((entry) => {
      const rider = riders.get(entry.rider_id);
      const replaced = entry.replaced_rider_id;
      return {
        riderId: entry.rider_id,
        rider: rider ? shapeRider(rider, lang, translations) : null,
        programNumber:
          ctx.programNumbers.get(entry.rider_id) ??
          (replaced !== null ? ctx.programNumbers.get(replaced) ?? null : null),
        replacedRiderId: replaced,
        gate: entry.gate,
        finishPosition: entry.finish_position,
        status: entry.status,
        points: entry.points,
      };
    })
    .sort((a, b) => (a.gate ?? 0) - (b.gate ?? 0));
}

export interface RaceShape {
  raceNumber: number;
  kind: string;
  status: string;
  entries: RaceEntryShape[];
}

export function shapeRaces(
  ctx: MeetingContext,
  riders: Map<number, RiderRow>,
  lang: Lang,
  translations: Map<string, string>,
): RaceShape[] {
  return ctx.races.map((race) => ({
    raceNumber: race.race_number,
    kind: race.kind,
    status: race.status,
    entries: shapeRaceEntries(ctx, race.id, riders, lang, translations),
  }));
}

export interface IntermediateShape {
  rank: number;
  riderId: number;
  heatPoints: number;
  requiresManualResolution: boolean;
}

export function shapeIntermediate(
  rows: IntermediateStandingRow[],
): { rows: IntermediateShape[]; hasBlockedTies: boolean; blockedGroups: number[][] } {
  const ordered = [...rows].sort((a, b) => a.rank - b.rank);
  const groups = new Map<number, number[]>();
  for (const row of ordered) {
    if (row.requires_manual_resolution !== 1) continue;
    const list = groups.get(row.heat_points) ?? [];
    list.push(row.rider_id);
    groups.set(row.heat_points, list);
  }
  return {
    rows: ordered.map((row) => ({
      rank: row.rank,
      riderId: row.rider_id,
      heatPoints: row.heat_points,
      requiresManualResolution: row.requires_manual_resolution === 1,
    })),
    hasBlockedTies: groups.size > 0,
    blockedGroups: [...groups.values()],
  };
}

export interface MeetingResultShape {
  rank: number;
  riderId: number;
  championshipPoints: number;
}

export function shapeMeetingResults(rows: MeetingResultRow[]): MeetingResultShape[] {
  return [...rows]
    .sort((a, b) => a.rank - b.rank)
    .map((row) => ({
      rank: row.rank,
      riderId: row.rider_id,
      championshipPoints: row.championship_points,
    }));
}
