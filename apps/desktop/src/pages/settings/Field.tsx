import type { ReactNode } from "react";

export const fieldInput =
  "w-72 rounded-lg border border-neutral-200 px-3 py-1.5 text-sm outline-none focus:border-neutral-400";

export function Row(props: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-neutral-100 py-4">
      <span className="text-sm text-neutral-700">{props.label}</span>
      {props.children}
    </div>
  );
}
