import type { MiddlewareHandler } from "hono";
import { parseIntCookie, verifySessionToken, SESSION_COOKIE } from "./auth";
import type { Env } from "./types";

export type AppEnv = { Bindings: Env };

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = parseIntCookie(c.req.header("cookie"), SESSION_COOKIE);
  if (!token || !(await verifySessionToken(c.env, token, Date.now()))) {
    return c.json({ error: "No autorizado." }, 401);
  }
  await next();
};

export function applyPublicCache(c: { header: (k: string, v: string) => void }, maxAge = 60, sMaxAge = 300): void {
  c.header("Cache-Control", `public, max-age=${maxAge}, s-maxage=${sMaxAge}`);
}
