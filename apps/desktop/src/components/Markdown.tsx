import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "../lib/cn.ts";

// Markdown with GFM + the app's prose styling — the ONE place the plugin set
// and base prose classes live. `children` render after the markdown (e.g. the
// streaming caret).
export function Markdown(props: { text: string; className?: string; children?: ReactNode }) {
  return (
    <div className={cn("prose prose-sm prose-neutral max-w-none", props.className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{props.text}</ReactMarkdown>
      {props.children}
    </div>
  );
}
