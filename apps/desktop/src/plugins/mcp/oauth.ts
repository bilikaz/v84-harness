// OAuth for HTTP-transport MCP servers — the SDK's OAuthClientProvider, the Electron glue around it, and
// machine-local token storage. MAIN-only (uses node:http + electron); imported solely by service.ts.
//
// Two server shapes, one provider: clientInformation() returns the configured client_id when the user set
// one (GitHub — a pre-registered OAuth App), or undefined to let the SDK dynamically register (Supabase).
// The SDK drives discovery / PKCE / token exchange; we own: opening the system browser, catching the
// redirect on a loopback listener, and persisting tokens (RFC 8252 native-app flow).

import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientMetadata, OAuthClientInformationMixed, OAuthClientInformationFull, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";

import { OAUTH_REDIRECT_PORT, OAUTH_REDIRECT_URI } from "./types.ts";

const electron = createRequire(import.meta.url)("electron") as typeof import("electron");

// ---- machine-local token store (NOT synced — refresh tokens stay on this device) -----------------------
// One file under userData, encrypted with the OS keychain via safeStorage when available; per server name.
interface Entry {
  clientInfo?: OAuthClientInformationFull; // dynamic-registration result (absent for pre-registered clients)
  tokens?: OAuthTokens;
}
type StoreData = Record<string, Entry>;

let cache: StoreData | null = null;
function storeFile(): string {
  return path.join(electron.app.getPath("userData"), "mcp-oauth.json");
}
function load(): StoreData {
  if (cache) return cache;
  try {
    if (existsSync(storeFile())) {
      const raw = readFileSync(storeFile());
      const json = electron.safeStorage.isEncryptionAvailable() ? electron.safeStorage.decryptString(raw) : raw.toString("utf8");
      cache = JSON.parse(json) as StoreData;
    } else cache = {};
  } catch {
    cache = {}; // unreadable / key changed → re-auth, never crash
  }
  return cache;
}
function persist(): void {
  const json = JSON.stringify(cache ?? {});
  const buf = electron.safeStorage.isEncryptionAvailable() ? electron.safeStorage.encryptString(json) : Buffer.from(json, "utf8");
  writeFileSync(storeFile(), buf);
}
function patch(name: string, p: Entry): void {
  const s = load();
  const merged: Entry = { ...s[name], ...p };
  if (merged.tokens === undefined) delete merged.tokens;
  if (merged.clientInfo === undefined) delete merged.clientInfo;
  s[name] = merged;
  persist();
}

// ---- the provider --------------------------------------------------------------------------------------
export class McpOAuthProvider implements OAuthClientProvider {
  private _state?: string;
  private _verifier?: string;
  // The SDK calls redirectToAuthorization with the authorize URL; we stash it and open it ourselves
  // (in an Electron window) once auth() returns REDIRECT.
  authorizeUrl?: string;

  constructor(
    private readonly serverName: string,
    private readonly cfg: { clientId?: string; clientSecret?: string; scopes?: string },
  ) {}

  get redirectUrl(): string {
    return OAUTH_REDIRECT_URI;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "v84-harness",
      redirect_uris: [OAUTH_REDIRECT_URI],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: this.cfg.clientSecret ? "client_secret_post" : "none",
      ...(this.cfg.scopes ? { scope: this.cfg.scopes } : {}),
    };
  }

  state(): string {
    this._state = randomBytes(16).toString("hex");
    return this._state;
  }
  expectedState(): string | undefined {
    return this._state;
  }

  // Configured client_id → pre-registered (GitHub); otherwise the dynamic-registration result, if any (Supabase).
  clientInformation(): OAuthClientInformationMixed | undefined {
    if (this.cfg.clientId) {
      return this.cfg.clientSecret ? { client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret } : { client_id: this.cfg.clientId };
    }
    return load()[this.serverName]?.clientInfo;
  }
  saveClientInformation(info: OAuthClientInformationFull): void {
    patch(this.serverName, { clientInfo: info });
  }

  tokens(): OAuthTokens | undefined {
    return load()[this.serverName]?.tokens;
  }
  saveTokens(tokens: OAuthTokens): void {
    patch(this.serverName, { tokens });
  }

  redirectToAuthorization(url: URL): void {
    this.authorizeUrl = url.toString(); // opened in an Electron window by authorizeInWindow()
  }

  // PKCE verifier — in-memory for the life of one connect flow (never persisted).
  saveCodeVerifier(v: string): void {
    this._verifier = v;
  }
  codeVerifier(): string {
    if (!this._verifier) throw new Error("no PKCE code verifier for this session");
    return this._verifier;
  }

  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): void {
    if (scope === "verifier") this._verifier = undefined;
    else if (scope === "tokens") patch(this.serverName, { tokens: undefined });
    else if (scope === "client") patch(this.serverName, { clientInfo: undefined });
    else if (scope === "all") {
      this._verifier = undefined;
      patch(this.serverName, { tokens: undefined, clientInfo: undefined });
    }
  }
}

// ---- loopback callback ---------------------------------------------------------------------------------
export interface Loopback {
  code: Promise<string>;
  close: () => void;
}

// Listen on the fixed loopback port for the authorization redirect. Resolves with the code once the user
// finishes in the browser; rejects on an error response or a state mismatch (CSRF guard).
export function startLoopback(stateMatches: (state: string | null) => boolean): Loopback {
  let resolve!: (code: string) => void;
  let reject!: (err: Error) => void;
  const code = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const page = (msg: string) => `<!doctype html><meta charset="utf-8"><body style="font:14px system-ui;padding:2rem">${msg}</body>`;
  const server = createServer((req, res) => {
    const u = new URL(req.url ?? "/", OAUTH_REDIRECT_URI);
    if (u.pathname !== "/callback") {
      res.writeHead(404);
      res.end();
      return;
    }
    const err = u.searchParams.get("error");
    const c = u.searchParams.get("code");
    res.writeHead(200, { "content-type": "text/html" });
    if (err) {
      res.end(page(`Authorization failed: ${err}. You can close this window.`));
      reject(new Error(`authorization denied: ${err}`));
    } else if (!c || !stateMatches(u.searchParams.get("state"))) {
      res.end(page("Authorization failed (state mismatch). You can close this window."));
      reject(new Error("authorization failed: missing code or state mismatch"));
    } else {
      res.end(page("Authorized — you can close this window and return to the app."));
      resolve(c);
    }
  });
  server.on("error", reject);
  server.listen(OAUTH_REDIRECT_PORT, "127.0.0.1");
  return { code, close: () => server.close() };
}

// Open the authorize URL in an in-app Electron window and resolve with the authorization code once the
// browser redirects to our loopback. Rejects if the user closes the window first. A persistent session
// partition keeps the user logged in across attempts. The loopback listener is started here so it's ready
// before the window can navigate back.
export async function authorizeInWindow(authorizeUrl: string, stateMatches: (state: string | null) => boolean): Promise<string> {
  const loopback = startLoopback(stateMatches);
  const win = new electron.BrowserWindow({
    width: 600,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: { partition: "persist:mcp-oauth", contextIsolation: true, sandbox: true },
  });
  void win.loadURL(authorizeUrl);
  let done = false;
  try {
    return await Promise.race([
      loopback.code.then((c) => {
        done = true;
        return c;
      }),
      // Reject only if the user closes the window BEFORE the callback arrives (not on our own close below).
      new Promise<string>((_, reject) => win.on("closed", () => done || reject(new Error("authorization window was closed")))),
    ]);
  } finally {
    loopback.close();
    if (!win.isDestroyed()) win.close();
  }
}
