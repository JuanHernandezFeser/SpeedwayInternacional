import { queryAll } from "./db";
import type { D1Database } from "./types";

export const SUPPORTED_LANGS = ["es", "en", "pl"] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];

/** Entity/field pairs that may have translations in the translations table. */
export const TRANSLATABLE_FIELDS: Record<string, readonly string[]> = {
  meeting: ["name", "venue"],
  rider: ["first_name", "last_name"],
};

export function isSupportedLang(value: string | undefined): value is Lang {
  return value !== undefined && (SUPPORTED_LANGS as readonly string[]).includes(value);
}

export function getLang(url: URL): Lang {
  const raw = url.searchParams.get("lang") ?? undefined;
  return isSupportedLang(raw) ? raw : "es";
}

export function translationKey(entityId: number, field: string): string {
  return `${entityId}:${field}`;
}

/**
 * Loads translations for a set of entities and fields. Spanish is the source
 * language and is stored on the entity itself, so it is never looked up here.
 */
export async function loadTranslations(
  db: D1Database,
  entity: string,
  entityIds: number[],
  lang: Lang,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (lang === "es" || entityIds.length === 0) return result;
  const placeholders = entityIds.map(() => "?").join(", ");
  const rows = await queryAll<{ entity_id: number; field: string; text: string }>(
    db,
    `SELECT entity_id, field, text FROM translations
     WHERE entity = ? AND lang = ? AND entity_id IN (${placeholders})`,
    [entity, lang, ...entityIds],
  );
  for (const row of rows) result.set(translationKey(row.entity_id, row.field), row.text);
  return result;
}

/** Returns the translated text when available, falling back to the Spanish source. */
export function translated(
  translations: Map<string, string>,
  entityId: number,
  field: string,
  spanishText: string,
): string {
  return translations.get(translationKey(entityId, field)) ?? spanishText;
}

/** Reads the current Spanish source text of an entity field (null if unknown). */
export async function spanishSourceText(
  db: D1Database,
  entity: string,
  entityId: number,
  field: string,
): Promise<string | null> {
  const table = entity === "meeting" ? "meetings" : entity === "rider" ? "riders" : null;
  if (!table) return null;
  if (!TRANSLATABLE_FIELDS[entity]?.includes(field)) return null;
  const row = await queryAll<Record<string, string>>(
    db,
    `SELECT ${field} AS value FROM ${table} WHERE id = ?`,
    [entityId],
  );
  return row[0]?.value ?? null;
}

export async function hashText(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  const bytes = new Uint8Array(digest);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
