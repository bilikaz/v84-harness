// Auth routes: register / login / refresh / logout.
//
//   POST /auth/register  { username, password } → { accessToken, refreshToken, ... }
//   POST /auth/login     { username, password } → { accessToken, refreshToken, ... }
//   POST /auth/refresh   { refreshToken }       → { accessToken, refreshToken, ... }
//   POST /auth/logout                           → 204  (revokes the current session)
//
// Optional `X-Device-Name` header labels the device in the sessions list.

import { Hono, type Context } from "hono";

import { openRepos } from "../../database/repos.ts";
import { hashPassword, issueTokens, rotateTokens, verifyPassword } from "./service.ts";
import { requireAuth, type AuthEnv } from "./middleware.ts";
import type { Credentials, RefreshBody } from "./types.ts";

function device(c: Context): { deviceName: string | null; ip: string | null } {
  return {
    deviceName: c.req.header("x-device-name") ?? null,
    ip: c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  };
}

export const authRouter = new Hono<AuthEnv>();

authRouter.post("/register", async (c) => {
  const { username, password } = await c.req.json<Credentials>();
  if (!username || !password) return c.json({ error: "username and password required" }, 400);
  const repos = openRepos();
  if (await repos.users.findByUsername(username)) return c.json({ error: "username taken" }, 409);
  const id = await repos.users.create(username, hashPassword(password));
  return c.json(await issueTokens(id, device(c)), 201);
});

authRouter.post("/login", async (c) => {
  const { username, password } = await c.req.json<Credentials>();
  if (!username || !password) return c.json({ error: "username and password required" }, 400);
  const user = await openRepos().users.findByUsername(username);
  if (!user || !verifyPassword(password, user.password_hash)) return c.json({ error: "invalid credentials" }, 401);
  return c.json(await issueTokens(user.id, device(c)));
});

authRouter.post("/refresh", async (c) => {
  const { refreshToken } = await c.req.json<RefreshBody>();
  if (!refreshToken) return c.json({ error: "refreshToken required" }, 400);
  const tokens = await rotateTokens(refreshToken);
  if (!tokens) return c.json({ error: "invalid or expired refresh token" }, 401);
  return c.json(tokens);
});

authRouter.post("/logout", requireAuth, async (c) => {
  await openRepos().authSessions.revokeById(c.get("sessionId"));
  return c.body(null, 204);
});
