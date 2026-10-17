import { Hono } from "hono";
import { HttpError } from "./http";
import { adminRoutes } from "./adminRoutes";
import { publicRoutes } from "./publicRoutes";
import type { AppEnv } from "./middleware";

const app = new Hono<AppEnv>();

app.onError((error, c) => {
  if (error instanceof HttpError) {
    return c.json({ error: error.message, details: error.details ?? null }, error.status as 400);
  }
  console.error(error);
  return c.json({ error: "Error interno del servidor." }, 500);
});

app.route("/api/admin", adminRoutes);
app.route("/api", publicRoutes);

app.all("*", async (c) => {
  if (c.env.ASSETS) return c.env.ASSETS.fetch(c.req.raw);
  return c.notFound();
});

export default app;
