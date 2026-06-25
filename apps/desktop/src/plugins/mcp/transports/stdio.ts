// stdio transport — spawns the MCP server as a child process. Needs node:child_process, so this module is
// MAIN-only (imported by service.ts, which the web bundle never globs). Kept apart from http.ts so a future
// web build can import only the HTTP transport.

import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { McpServer } from "../types.ts";

type StdioServer = Extract<McpServer, { transport: "stdio" }>;

// override env (transient secrets) layers over the saved env; both over a safe default environment.
export function stdioTransport(server: StdioServer, env?: Record<string, string>): Transport {
  return new StdioClientTransport({
    command: server.command,
    args: server.args ?? [],
    env: { ...getDefaultEnvironment(), ...server.env, ...env },
  });
}
