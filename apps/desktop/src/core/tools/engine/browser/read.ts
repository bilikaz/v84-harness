import { cap } from "../../base.ts";
import type { browserFleet } from "../../../browser.ts";

type Fleet = ReturnType<typeof browserFleet>;
type ReadResult = { output: string; images?: { url: string; mime: string; name: string }[] };

// The shared READ of a browser window: live url/title/text, the links to navigate next, and a snapshot.
// Used by both Browser (returned after a load, so no separate read is needed) and BrowserContent (a
// re-read). The snapshot is always attached for the user's preview; the engine withholds it from a
// text-only model. Null when the window is gone — the caller phrases the closed message with its hint.
export async function readWindow(fleet: Fleet, alias: string, id: string): Promise<ReadResult | null> {
  const content = await fleet.getContent(id);
  if (!content) return null;
  // The navigation failed at the network level (DNS/refused/timeout) — there is no page to read or
  // screenshot. Tell the agent plainly so it doesn't puzzle over a blank result.
  if (content.error) return { output: `browser ${alias} could not load ${content.url || "the page"}: ${content.error}.` };
  const links = content.links.length ? `\n\nLinks on this page (navigate with Browser {id: ${alias}, url}):\n${content.links.join("\n")}` : "";
  const shots = await fleet.capturePage(id);
  const images = shots.length ? shots.map((url, i) => ({ url, mime: "image/png", name: `browser-${alias}${i ? `-${i + 1}` : ""}.png` })) : undefined;
  return { output: cap(`browser ${alias} — ${content.title}\nurl: ${content.url}\n\n${content.text}${links}`), images };
}
