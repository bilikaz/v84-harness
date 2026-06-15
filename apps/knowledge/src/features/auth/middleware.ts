// requireAuth — verify the access JWT (stateless, no DB hit) and expose
// { userId, sessionId } to handlers. Shared by the sessions + data features.

import type { MiddlewareHandler } from "hono";
import { verify } from "hono/jwt";

import { config } from "../../config/config.ts";

export type AuthEnv = { Variables: { userId: number; sessionId: string } };

export const requireAuth: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return c.json({ error: "missing bearer token" }, 401);
  try {
    const payload = await verify(token, config.auth.jwtSecret, "HS256");
    c.set("userId", Number(payload.sub));
    c.set("sessionId", String(payload.sessionId));
  } catch {
    return c.json({ error: "invalid or expired token" }, 401);
  }
  await next();
};
