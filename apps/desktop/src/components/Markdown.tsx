import { memo, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "../lib/cn.ts";

// GFM + prose styling. Children render after the markdown (e.g. streaming caret). Memoized: in a long
// transcript, one message streaming would otherwise re-parse EVERY other Markdown block on each token —
// non-streaming messages have stable props (no children), so memo skips their re-parse.
export const Markdown = memo(function Markdown(props: { text: string; className?: string; children?: ReactNode }) {
  return (
    <div className={cn("prose prose-sm prose-neutral max-w-none", props.className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{props.text}</ReactMarkdown>
      {props.children}
    </div>
  );
});
