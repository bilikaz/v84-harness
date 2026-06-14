// The one React bridge to ctx: the renderer can't take ctx by constructor like core classes do, so it reads it
// from context. Set once at boot (main.tsx wraps App in CtxProvider with the init() result); useCtx() everywhere else.
// Renderer-only — ctx.ts itself stays React-free so the main process can construct a Ctx without pulling in React.
import { createContext, useContext, type ReactNode } from "react";
import type { Ctx } from "../core/ctx.ts";

const CtxContext = createContext<Ctx | null>(null);

export function CtxProvider({ value, children }: { value: Ctx; children: ReactNode }) {
  return <CtxContext.Provider value={value}>{children}</CtxContext.Provider>;
}

export function useCtx(): Ctx {
  const ctx = useContext(CtxContext);
  if (!ctx) throw new Error("useCtx must be used within a CtxProvider");
  return ctx;
}
