import { execute, queryOne } from "./db";
import type { D1Database, Env } from "./types";

export const SESSION_COOKIE = "sw_admin_session";
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const LOGIN_WINDOW_SECONDS = 15 * 60;
const MAX_LOGIN_ATTEMPTS = 5;

function toBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return toBase64Url(signature);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function parseIntCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

export async function createSessionToken(env: Env, nowMs: number): Promise<string> {
  const expires = Math.floor(nowMs / 1000) + SESSION_TTL_SECONDS;
  const signature = await hmac(env.SESSION_SECRET, `v1:${expires}`);
  return `${expires}.${signature}`;
}

export async function verifySessionToken(
  env: Env,
  token: string,
  nowMs: number,
): Promise<boolean> {
  const [expiresRaw, signature] = token.split(".");
  if (!expiresRaw || !signature) return false;
  const expires = Number(expiresRaw);
  if (!Number.isInteger(expires) || expires <= Math.floor(nowMs / 1000)) return false;
  const expected = await hmac(env.SESSION_SECRET, `v1:${expires}`);
  return timingSafeEqual(signature, expected);
}

export function sessionCookieHeader(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

function currentWindowId(nowMs: number): number {
  return Math.floor(nowMs / 1000 / LOGIN_WINDOW_SECONDS);
}

export async function loginAllowed(
  db: D1Database,
  ip: string,
  nowMs: number,
): Promise<boolean> {
  const windowId = currentWindowId(nowMs);
  await execute(db, "DELETE FROM login_attempts WHERE window_id < ?", [windowId]);
  const row = await queryOne<{ attempts: number }>(
    db,
    "SELECT attempts FROM login_attempts WHERE ip = ? AND window_id = ?",
    [ip, windowId],
  );
  return (row?.attempts ?? 0) < MAX_LOGIN_ATTEMPTS;
}

export async function registerFailedLogin(
  db: D1Database,
  ip: string,
  nowMs: number,
): Promise<void> {
  await execute(
    db,
    `INSERT INTO login_attempts (ip, window_id, attempts) VALUES (?, ?, 1)
     ON CONFLICT (ip, window_id) DO UPDATE SET attempts = attempts + 1`,
    [ip, currentWindowId(nowMs)],
  );
}

export async function clearLoginAttempts(db: D1Database, ip: string): Promise<void> {
  await execute(db, "DELETE FROM login_attempts WHERE ip = ?", [ip]);
}
