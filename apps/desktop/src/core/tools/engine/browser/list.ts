import { browserFleet, type FleetWindow } from "../../../browser.ts";

// Shared formatting for a session's windows — used by ActiveBrowsers AND by every bad-id error, so a wrong
// guess hands the model the valid set inline (the resolveAgent-on-miss pattern) instead of nudging it to
// open yet another window. Helper export, skipped by the engine glob's BaseEngineTool check.

function windowLine(w: FleetWindow): string {
  return `- browser ${w.alias} — ${w.title || "(untitled)"} — ${w.url}${w.state === "active" ? " (shown)" : ""}`;
}

// The session's live windows as a list (with a header), or a start-one hint if it has none.
export function sessionWindowsHint(sid: string): string {
  const mine = browserFleet().windowsForSession(sid);
  if (!mine.length) return 'You have no browser windows open — Browser {id:"new", url} to start one.';
  return "Your open browser windows:\n" + mine.map(windowLine).join("\n");
}
