import { register } from "../../lib/registry.ts";
import { ProgressPanel } from "./ProgressPanel.tsx";
import logoUrl from "../../logo.svg";

// left-top: the brand. The logo mark reads "V84"; the wordmark completes it
// to "V84 Harness".
function Brand() {
  return (
    <div className="flex items-center gap-2 px-1 py-0.5">
      <img src={logoUrl} alt="V84" className="h-7 w-7" />
      <span className="text-base font-semibold tracking-tight text-neutral-900">Harness</span>
    </div>
  );
}

register(
  { region: "left-top", id: "brand", render: () => <Brand /> },
  { region: "right-panel", id: "progress", order: 0, render: () => <ProgressPanel /> },
);
