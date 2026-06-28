// Auth logic: password hashing, access-JWT signing, and refresh-token issue +
// rotation against the sessions table. Routers call these; only repos touch the DB.
//
// Token model (ported from legal-help, DB-only — no Redis):
//   access  = short-lived JWT { sub, sessionId }, verified statelessly (middleware)
//   refresh = "<sessionId>.<secret>"; only sha256(secret) is stored, with expires_at.
//             Every refresh ROTATES the secret, so a captured refresh dies on next use.

import { sign } from "hono/jwt";
import { createHash, randomBytes, randomUUID, scrypt as scryptCb, scryptSync, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

// scrypt is CPU/memory-heavy by design (~tens of ms). The async form keeps it OFF the event loop so a
// burst of logins/registers can't stall every other request — the sync form would serialise them all.
const scrypt = promisify(scryptCb) as (password: string | Buffer, salt: string | Buffer, keylen: number) => Promise<Buffer>;

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

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const hash = await scrypt(password, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(hashHex, "hex");
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}

// Login against a possibly-absent user WITHOUT leaking which usernames exist: when there's no stored
// hash, verify against a real decoy so the scrypt cost (and thus response time) is the same whether or
// not the username is real. Returns false for the decoy path. DECOY is computed once at module load —
// the one-time sync hash at startup is fine (it's not on any request path).
const DECOY_SALT = randomBytes(16);
const DECOY_HASH = `${DECOY_SALT.toString("hex")}:${scryptSync(randomBytes(32).toString("hex"), DECOY_SALT, 64).toString("hex")}`;
export async function verifyLogin(password: string, stored: string | undefined): Promise<boolean> {
  const ok = await verifyPassword(password, stored ?? DECOY_HASH);
  return stored !== undefined && ok;
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
  await openRepos().authSessions.create({
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
  const session = await repos.authSessions.findById(sessionId);
  if (!session) return null;
  if (session.expires_at.getTime() < Date.now()) {
    await repos.authSessions.revokeById(sessionId);
    return null;
  }
  const presented = sha256(secret);
  if (!equalHex(presented, session.refresh_token_hash)) {
    // Not the current token. The just-rotated-out `prev` is only legitimately held by a client whose
    // rotation RESPONSE was lost and is retrying — accept that within the grace window and rotate again.
    // Outside the window (or any other token) it's a replay/theft signal → revoke the whole session.
    const matchesPrev = !!session.prev_refresh_token_hash && equalHex(presented, session.prev_refresh_token_hash);
    const withinGrace = Date.now() - session.last_seen_at.getTime() <= config.auth.refreshReuseGraceMs;
    if (matchesPrev && withinGrace) {
      // fall through — re-rotate and hand the retrying client a fresh pair
    } else {
      if (matchesPrev) await repos.authSessions.revokeById(sessionId);
      return null;
    }
  }

  const { token: refreshTokenNew, hash } = newRefreshToken(sessionId);
  await repos.authSessions.rotate(sessionId, hash, session.refresh_token_hash, new Date(Date.now() + config.auth.refreshTtl * 1000));
  return { accessToken: await signAccess(session.user_id, sessionId), refreshToken: refreshTokenNew, expiresIn: config.auth.accessTtl, tokenType: "Bearer" };
}
