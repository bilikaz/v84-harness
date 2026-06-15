// Auth logic: password hashing, access-JWT signing, and refresh-token issue +
// rotation against the sessions table. Routers call these; only repos touch the DB.
//
// Token model (ported from legal-help, DB-only — no Redis):
//   access  = short-lived JWT { sub, sessionId }, verified statelessly (middleware)
//   refresh = "<sessionId>.<secret>"; only sha256(secret) is stored, with expires_at.
//             Every refresh ROTATES the secret, so a captured refresh dies on next use.

import { sign } from "hono/jwt";
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";

import { config } from "../../config/config.ts";
import { openRepos } from "../../database/repos.ts";

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // access TTL, seconds
  tokenType: "Bearer";
}

export interface DeviceInfo {
  deviceName?: string | null;
  ip?: string | null;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const hash = scryptSync(password, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(hashHex, "hex");
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

function equalHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// Refresh token is "<sessionId>.<secret>" — the id finds the row in one query,
// the secret half is what's hashed + compared.
function newRefreshToken(sessionId: string): { token: string; hash: string } {
  const secret = randomBytes(32).toString("hex");
  return { token: `${sessionId}.${secret}`, hash: sha256(secret) };
}

function signAccess(userId: number, sessionId: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign({ sub: String(userId), sessionId, iat: now, exp: now + config.auth.accessTtl }, config.auth.jwtSecret, "HS256");
}

// Open a fresh device session + token pair.
export async function issueTokens(userId: number, device: DeviceInfo): Promise<AuthTokens> {
  const sessionId = randomUUID();
  const { token: refreshToken, hash } = newRefreshToken(sessionId);
  await openRepos().sessions.create({
    id: sessionId,
    user_id: userId,
    refresh_token_hash: hash,
    device_name: device.deviceName ?? null,
    ip_address: device.ip ?? null,
    expires_at: new Date(Date.now() + config.auth.refreshTtl * 1000),
  });
  return { accessToken: await signAccess(userId, sessionId), refreshToken, expiresIn: config.auth.accessTtl, tokenType: "Bearer" };
}

// Validate a refresh token and mint a new access + new refresh (rotation).
// Returns null on any failure (unknown/expired/mismatched) — caller 401s.
export async function rotateTokens(refreshToken: string): Promise<AuthTokens | null> {
  const [sessionId, secret] = refreshToken.split(".");
  if (!sessionId || !secret) return null;

  const repos = openRepos();
  const session = await repos.sessions.findById(sessionId);
  if (!session) return null;
  if (session.expires_at.getTime() < Date.now()) {
    await repos.sessions.revokeById(sessionId);
    return null;
  }
  if (!equalHex(sha256(secret), session.refresh_token_hash)) return null;

  const { token: refreshTokenNew, hash } = newRefreshToken(sessionId);
  await repos.sessions.rotate(sessionId, hash, new Date(Date.now() + config.auth.refreshTtl * 1000));
  return { accessToken: await signAccess(session.user_id, sessionId), refreshToken: refreshTokenNew, expiresIn: config.auth.accessTtl, tokenType: "Bearer" };
}
