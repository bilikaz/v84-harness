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

// Bounds: cap stored/looked-up strings (storage + DoS guard) and set a password floor on register.
const LIMITS = { usernameMin: 2, usernameMax: 64, passwordMin: 8, passwordMax: 128, deviceMax: 128, ipMax: 64 };

// Length policy over already-typechecked strings. `setting` enforces the password floor (register only);
// login skips it — there a short/old password just won't verify, and a floor would lock out pre-policy accounts.
function lengthError(username: string, password: string, setting: boolean): string | null {
  if (username.length < LIMITS.usernameMin || username.length > LIMITS.usernameMax)
    return `username must be ${LIMITS.usernameMin}–${LIMITS.usernameMax} characters`;
  if (password.length < 1 || password.length > LIMITS.passwordMax) return `password must be 1–${LIMITS.passwordMax} characters`;
  if (setting && password.length < LIMITS.passwordMin) return `password must be at least ${LIMITS.passwordMin} characters`;
  return null;
}

function device(c: Context): { deviceName: string | null; ip: string | null } {
  // Header values are attacker-controlled — cap length so they can't bloat the row (and keep the sessions
  // list bounded). The UI renders them through React, which escapes, so length is the real risk, not markup.
  const cap = (v: string | undefined, max: number): string | null => (v ? v.slice(0, max) : null);
  return {
    deviceName: cap(c.req.header("x-device-name"), LIMITS.deviceMax),
    ip: cap(c.req.header("x-forwarded-for")?.split(",")[0]?.trim(), LIMITS.ipMax),
  };
}

export const authRouter = new Hono<AuthEnv>();

authRouter.post("/register", async (c) => {
  const { username, password } = await c.req.json<Credentials>();
  if (typeof username !== "string" || typeof password !== "string") return c.json({ error: "username and password required" }, 400);
  const bad = lengthError(username, password, true);
  if (bad) return c.json({ error: bad }, 400);
  const repos = openRepos();
  if (await repos.users.findByUsername(username)) return c.json({ error: "username taken" }, 409);
  const id = await repos.users.create(username, hashPassword(password));
  return c.json(await issueTokens(id, device(c)), 201);
});

authRouter.post("/login", async (c) => {
  const { username, password } = await c.req.json<Credentials>();
  if (typeof username !== "string" || typeof password !== "string") return c.json({ error: "username and password required" }, 400);
  const bad = lengthError(username, password, false);
  if (bad) return c.json({ error: bad }, 400);
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
