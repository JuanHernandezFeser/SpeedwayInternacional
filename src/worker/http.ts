import type { Context } from "hono";

export class HttpError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function badRequest(message: string): HttpError {
  return new HttpError(400, message);
}

export function notFound(message = "No encontrado."): HttpError {
  return new HttpError(404, message);
}

export function conflict(message: string, details?: unknown): HttpError {
  return new HttpError(409, message, details);
}

export async function readJson<T>(c: Context): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    throw badRequest("El cuerpo de la petición no es JSON válido.");
  }
}

export function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw badRequest(`El campo "${field}" es inválido.`);
  }
  return value as Record<string, unknown>;
}

export function asArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw badRequest(`El campo "${field}" debe ser una lista.`);
  return value;
}

export function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw badRequest(`El campo "${field}" es obligatorio.`);
  }
  return value.trim();
}

export function asOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

export function asInt(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed)) throw badRequest(`El campo "${field}" debe ser un entero.`);
  return parsed;
}

export function asBoolean(value: unknown, field: string): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  throw badRequest(`El campo "${field}" debe ser booleano.`);
}
