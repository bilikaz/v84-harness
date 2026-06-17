import { type ToolResult, type ToolSpec, type ToolPermission } from "../types.ts";
import { errorMessage } from "../../../lib/errors.ts";
import { BaseTool } from "../base.ts";

// Direct HTTP from the agent — talk to an API/endpoint WITHOUT a browser. The agent sets method, headers
// (e.g. Authorization), and body, so it can authenticate and act against real services. That power cuts
// both ways (an arbitrary request can send the user's data anywhere, reach internal hosts), so it is
// PERMISSIONED and defaults to ASK — the human approves each call; set the per-workspace mode to allow for
// a trusted API. In electron it runs in MAIN (no CORS); on the web host it's subject to the browser's CORS.
// Use the browser tools instead for pages meant to be viewed/navigated.
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

export class Fetch extends BaseTool {
  override isPermissioned(): boolean {
    return true;
  }
  override defaultPermission(): ToolPermission {
    return 1; // ask
  }

  get schema(): ToolSpec {
    return {
      type: "function",
      function: {
        name: "Fetch",
        description:
          "Make an HTTP request to a URL and return the response — for talking to APIs without a browser. " +
          "Set method, headers (e.g. Authorization, Content-Type), and a body for POST/PUT/PATCH. Returns " +
          "the status line, response headers, and body (capped). For pages meant to be viewed or navigated, " +
          "use the Browser tools instead.",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string", description: "Absolute URL (http:// or https://)." },
            method: { type: "string", enum: METHODS, description: "HTTP method. Default GET." },
            headers: { type: "object", additionalProperties: { type: "string" }, description: "Request headers, e.g. { \"Authorization\": \"Bearer …\" }." },
            body: { type: "string", description: "Request body for POST/PUT/PATCH (e.g. a JSON string). Ignored for GET/HEAD." },
          },
          required: ["url"],
          additionalProperties: false,
        },
      },
    };
  }

  async run(args: Record<string, unknown>, _cwd?: string, signal?: AbortSignal): Promise<ToolResult> {
    const url = String(args.url ?? "").trim();
    if (!url) return { ok: false, output: 'Fetch needs a url, e.g. {"url":"https://api.example.com/v1/…"}.' };
    if (!/^https?:\/\//i.test(url)) return { ok: false, output: `Fetch rejected: "${url}" — url must be an absolute http(s) URL.` };
    const method = (typeof args.method === "string" && args.method.trim() ? args.method : "GET").toUpperCase();
    const headers = args.headers && typeof args.headers === "object" ? (args.headers as Record<string, string>) : undefined;
    // GET/HEAD can't carry a body (fetch throws) — drop it rather than fail the call.
    const body = method !== "GET" && method !== "HEAD" && typeof args.body === "string" ? args.body : undefined;
    try {
      const res = await fetch(url, { method, headers, body, signal, redirect: "follow" });
      const text = await res.text();
      const hdrs = [...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).join("\n");
      return { ok: res.ok, output: this.cap(`${res.status} ${res.statusText}\n${hdrs}\n\n${text}`) };
    } catch (e) {
      return { ok: false, output: `Fetch failed for ${method} ${url}: ${errorMessage(e)}` };
    }
  }
}
