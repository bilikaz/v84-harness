// Driver-level read tools for the browser fleet — like the ListAgents/RunAgent pair, these
// need ctx (the host fleet), so they dispatch in the engine before the registry paths rather
// than living in the tool registry. Advertised only when the host has a browser fleet
// (electron); on the web host browserToolSchemas() is empty and the tools never appear.
//
//   ActiveWindows — the live fleet (a window absent here is the agent's "it's gone" signal)
//   GetWindow     — current url/title/text for one window id

import { browserFleet } from "./browser.ts";
import { cap } from "./tools/base.ts";
import type { ToolSpec, ToolCallRequest } from "./tools/types.ts";

export const GET_WINDOW = "GetWindow";
export const ACTIVE_WINDOWS = "ActiveWindows";
export const NAVIGATE_WINDOW = "Navigate";

const ACTIVE_SCHEMA: ToolSpec = {
  type: "function",
  function: {
    name: ACTIVE_WINDOWS,
    description:
      "List the browser windows that are currently open: their ids, titles and urls. " +
      "A window you were given earlier that is NOT listed here has been closed — its content is gone. " +
      "Use this to check a window is still live before reading it.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
};

const GET_SCHEMA: ToolSpec = {
  type: "function",
  function: {
    name: GET_WINDOW,
    description:
      "Read a browser window by id: its current url, title and extracted page text. " +
      "Use the id from a forwarded window or from ActiveWindows. Returns the live page, so the " +
      "content reflects any navigation since it was forwarded.",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "The window id, exactly as given." } },
      required: ["id"],
      additionalProperties: false,
    },
  },
};

const NAVIGATE_SCHEMA: ToolSpec = {
  type: "function",
  function: {
    name: NAVIGATE_WINDOW,
    description:
      "Navigate a browser window to a new URL (it loads in place, keeping the window's session/login). " +
      "Pick the url from the links GetWindow lists, then read the new page with GetWindow.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "The window id." },
        url: { type: "string", description: "Absolute URL to load." },
      },
      required: ["id", "url"],
      additionalProperties: false,
    },
  },
};

export function browserToolSchemas(): ToolSpec[] {
  return browserFleet()?.available() ? [ACTIVE_SCHEMA, GET_SCHEMA, NAVIGATE_SCHEMA] : [];
}

export function isBrowserTool(name: string): boolean {
  return name === GET_WINDOW || name === ACTIVE_WINDOWS || name === NAVIGATE_WINDOW;
}

export async function execBrowserTool(call: ToolCallRequest): Promise<string> {
  const fleet = browserFleet();
  if (!fleet?.available()) return "the browser-window fleet is not available on this host.";

  if (call.name === ACTIVE_WINDOWS) {
    const live = await fleet.refresh();
    if (!live.length) return "No browser windows are open.";
    return (
      "Open browser windows:\n" +
      live.map((w) => `- window ${w.id} — ${w.title || "(untitled)"} — ${w.url}${w.active ? " (shown)" : ""}`).join("\n")
    );
  }

  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(call.arguments || "{}") as Record<string, unknown>;
  } catch {
    /* keep {} — the checks below answer with usage */
  }
  const id = String(args.id ?? "").trim();

  if (call.name === NAVIGATE_WINDOW) {
    if (!id) return "Navigate needs an id and a url.";
    const url = String(args.url ?? "").trim();
    if (!url) return "Navigate needs a url to load.";
    await fleet.navigate(id, url);
    return `window ${id} is loading ${url}. Read it with GetWindow once it settles.`;
  }

  // GetWindow
  if (!id) return "GetWindow needs an id — the window id from a forwarded window or ActiveWindows.";
  const content = await fleet.getContent(id);
  if (!content) return `window ${id} is no longer open — it was closed, so its content is gone.`;
  const links = content.links.length ? `\n\nLinks on this page (navigate to one with Navigate):\n${content.links.join("\n")}` : "";
  return cap(`window ${id} — ${content.title}\nurl: ${content.url}\n\n${content.text}${links}`);
}
