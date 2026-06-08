import { Fragment } from "react";

import { contributionsFor, type Region } from "../lib/registry.ts";

// Renders every contribution registered for a region, in order. The shell drops
// these where each region lives; the registry (filled at boot) fills them.
export function Slot({ region }: { region: Region }) {
  return (
    <>
      {contributionsFor(region).map((c) => (
        <Fragment key={c.id}>{c.render()}</Fragment>
      ))}
    </>
  );
}
