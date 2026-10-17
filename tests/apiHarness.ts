import { Database } from "bun:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import app from "../src/worker/index";
import type { D1Database, Env, R2Bucket, R2ObjectBody } from "../src/worker/types";

class D1Statement {
  constructor(
    private db: Database,
    private sql: string,
    private params: unknown[] = [],
  ) {}

  bind(...values: unknown[]): D1Statement {
    return new D1Statement(this.db, this.sql, values);
  }

  async all<T = Record<string, unknown>>(): Promise<{
    results: T[];
    success: boolean;
    meta: Record<string, unknown>;
  }> {
    const results = this.db.query(this.sql).all(...(this.params as never[])) as T[];
    return { results, success: true, meta: {} };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const row = this.db.query(this.sql).get(...(this.params as never[]));
    return (row as T) ?? null;
  }

  async run(): Promise<{ results: never[]; success: boolean; meta: Record<string, unknown> }> {
    const info = this.db.query(this.sql).run(...(this.params as never[]));
    return {
      results: [],
      success: true,
      meta: {
        last_row_id: Number(info.lastInsertRowid),
        changes: info.changes,
      },
    };
  }
}

export function createTestDb(): D1Database {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  const migrationsDir = join(process.cwd(), "migrations");
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const file of files) {
    db.exec(readFileSync(join(migrationsDir, file), "utf8"));
  }
  const adapter = {
    prepare(sql: string) {
      return new D1Statement(db, sql);
    },
    async batch(statements: D1Statement[]) {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
    async exec(sql: string) {
      db.exec(sql);
      return { count: 0 };
    },
  };
  return adapter as unknown as D1Database;
}

export function createR2Mock(): R2Bucket {
  const store = new Map<string, { body: Uint8Array; contentType: string }>();
  return {
    async put(key, value, options) {
      const bytes =
        value instanceof ArrayBuffer
          ? new Uint8Array(value)
          : typeof value === "string"
            ? new TextEncoder().encode(value)
            : new Uint8Array(0);
      store.set(key, {
        body: bytes,
        contentType: options?.httpMetadata?.contentType ?? "application/octet-stream",
      });
      return {};
    },
    async get(key): Promise<R2ObjectBody | null> {
      const object = store.get(key);
      if (!object) return null;
      return {
        body: new Blob([object.body]).stream(),
        size: object.body.byteLength,
        httpMetadata: { contentType: object.contentType },
      };
    },
    async delete(key) {
      for (const k of Array.isArray(key) ? key : [key]) store.delete(k);
    },
  };
}

export function makeEnv(db: D1Database): Env {
  return {
    DB: db,
    PHOTOS: createR2Mock(),
    ADMIN_PASSWORD: "test-password",
    SESSION_SECRET: "test-secret",
  };
}

export interface ApiOptions {
  method?: string;
  body?: unknown;
  cookie?: string;
  rawBody?: ArrayBuffer;
  headers?: Record<string, string>;
}

export async function api(env: Env, path: string, options: ApiOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.cookie) headers["cookie"] = options.cookie;
  let body: string | ArrayBuffer | undefined;
  if (options.rawBody !== undefined) {
    body = options.rawBody;
  } else if (options.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  return app.request(path, { method: options.method ?? "GET", headers, body }, env);
}

export async function login(env: Env): Promise<string> {
  const response = await api(env, "/api/admin/login", {
    method: "POST",
    body: { password: env.ADMIN_PASSWORD },
  });
  if (response.status !== 200) throw new Error(`Login failed: ${response.status}`);
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) throw new Error("No session cookie returned.");
  return setCookie.split(";")[0]!;
}

export async function seedRiders(db: D1Database, count = 18): Promise<void> {
  for (let i = 1; i <= count; i++) {
    await db
      .prepare(
        "INSERT INTO riders (permanent_number, first_name, last_name, country_iso) VALUES (?, ?, ?, ?)",
      )
      .bind(600 + i, `Nombre${i}`, `Apellido${i}`, "AR")
      .run();
  }
}

export function makeDrawBody(): { titulares: { riderId: number; programNumber: number }[]; reserves: number[] } {
  return {
    titulares: Array.from({ length: 16 }, (_, i) => ({ riderId: i + 1, programNumber: i + 1 })),
    reserves: [17, 18],
  };
}
