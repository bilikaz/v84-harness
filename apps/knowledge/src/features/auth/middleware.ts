// requireAuth — verify the access JWT, confirm the session still exists, and expose
// { userId, sessionId } to handlers. Shared by the sessions + data features.
//
// The session lookup (one indexed PK read) is what makes logout/revoke take effect immediately: the
// access JWT is short-lived but otherwise self-contained, so without it a deleted session's token would
// keep working until its exp. Cheap at this scale; the trade-off is one DB hit per authenticated request.

import type { MiddlewareHandler } from "hono";
import { verify } from "hono/jwt";

import { config } from "../../config/config.ts";
import { openRepos } from "../../database/repos.ts";

export type AuthEnv = { Variables: { userId: number; sessionId: string } };

export const requireAuth: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return c.json({ error: "missing bearer token" }, 401);
  let userId: number;
  let sessionId: string;
  try {
    const payload = await verify(token, config.auth.jwtSecret, "HS256");
    userId = Number(payload.sub);
    sessionId = String(payload.sessionId);
  } catch {
    return c.json({ error: "invalid or expired token" }, 401);
  }
  // Revoked/logged-out sessions are DELETED — a missing row means the token is no longer honoured.
  const session = await openRepos().authSessions.findById(sessionId);
  if (!session) return c.json({ error: "session revoked" }, 401);
  c.set("userId", userId);
  c.set("sessionId", sessionId);
  await next();
};
