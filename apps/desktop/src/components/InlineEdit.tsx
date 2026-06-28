import { useRef } from "react";

import { cn } from "../lib/cn.ts";

// Inline rename input: Enter/blur commits, Escape cancels.
export function InlineEdit(props: {
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  className?: string;
}) {
  // Enter/Escape both blur the input (Escape via unmount), and blur fires onCommit — so without this
  // guard, Escape would CANCEL and then immediately COMMIT the draft. Mark the key-driven outcome so the
  // trailing blur is a no-op.
  const settled = useRef(false);
  return (
    <input
      autoFocus
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          settled.current = true;
          props.onCommit();
        } else if (e.key === "Escape") {
          settled.current = true;
          props.onCancel();
        }
      }}
      onBlur={() => {
        if (!settled.current) props.onCommit();
      }}
      className={cn("rounded-md text-sm outline-none ring-1 ring-neutral-300", props.className)}
    />
  );
}
