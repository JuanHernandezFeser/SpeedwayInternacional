/**
 * Minimal structural types for the Cloudflare bindings used by this Worker.
 * They intentionally cover only the methods the project uses, so the code and
 * its tests (which run on Bun with an in-memory D1/SQLite adapter) share the
 * same contract without depending on the global Workers types.
 */

export type D1Value = string | number | null | ArrayBuffer;

export interface D1Meta {
  last_row_id?: number;
  changes?: number;
  duration?: number;
  [key: string]: unknown;
}

export interface D1Result<T> {
  results: T[];
  success: boolean;
  meta: D1Meta;
}

export interface D1PreparedStatement {
  bind(...values: D1Value[]): D1PreparedStatement;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<D1Result<never>>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<{ count: number; duration?: number }>;
}

export interface R2ObjectBody {
  body: ReadableStream;
  size: number;
  httpMetadata?: { contentType?: string };
}

export interface R2PutOptions {
  httpMetadata?: { contentType?: string };
}

export interface R2Bucket {
  put(
    key: string,
    value: ArrayBuffer | ReadableStream | string | Blob,
    options?: R2PutOptions,
  ): Promise<unknown>;
  get(key: string): Promise<R2ObjectBody | null>;
  delete(key: string | string[]): Promise<void>;
}

export interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  ASSETS?: Fetcher;
  ADMIN_PASSWORD: string;
  SESSION_SECRET: string;
}

export interface RiderRow {
  id: number;
  permanent_number: number;
  first_name: string;
  last_name: string;
  country_iso: string;
  photo_key: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface MeetingRow {
  id: number;
  name: string;
  meeting_date: string;
  venue: string;
  status: "scheduled" | "drawn" | "in_progress" | "completed";
  created_at: string;
  updated_at: string;
}

export interface MeetingEntryRow {
  id: number;
  meeting_id: number;
  rider_id: number;
  program_number: number | null;
  is_reserve: number;
}

export interface RaceRow {
  id: number;
  meeting_id: number;
  race_number: number;
  kind: "heat" | "lcq1" | "lcq2" | "final";
  status: "pending" | "gates_assigned" | "completed";
  created_at: string;
}

export interface RaceEntryRow {
  id: number;
  race_id: number;
  rider_id: number;
  replaced_rider_id: number | null;
  gate: number | null;
  finish_position: number | null;
  status: "ok" | "M" | "R" | "F" | "T" | "d" | "N";
  points: number | null;
}

export interface IntermediateStandingRow {
  id: number;
  meeting_id: number;
  rider_id: number;
  heat_points: number;
  rank: number;
  requires_manual_resolution: number;
  manual_order: number | null;
}

export interface MeetingResultRow {
  id: number;
  meeting_id: number;
  rider_id: number;
  rank: number;
  championship_points: number;
}

export interface ChampionshipStandingRow {
  rider_id: number;
  rank: number;
  total_points: number;
  updated_at: string;
}

export interface RiderStatsRow {
  rider_id: number;
  meetings_disputed: number;
  best_meeting_result: number | null;
  heats_raced: number;
  heat_wins: number;
  points_avg: number;
  final_appearances: number;
}

export interface TranslationRow {
  entity: string;
  entity_id: number;
  field: string;
  lang: string;
  text: string;
  source_hash: string | null;
  updated_at: string;
}
