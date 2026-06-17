import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "../App.tsx";
import { CtxProvider } from "./ctx.tsx";
import "../index.css";
import "../lib/i18n.ts";

import.meta.glob("../pages/**/register.{ts,tsx}", { eager: true });
// Plugin UI contributions self-register the same way features do (each tagged with its plugin slug).
import.meta.glob("../plugins/*/ui/register.{ts,tsx}", { eager: true });

// The one place platform is chosen — detect the desktop bridge inline so the boot stays bridge-agnostic.
const { init } = "api" in window
  ? await import("../electron/init.ts")
  : await import("../web/init.ts");

const ctx = await init();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CtxProvider value={ctx}>
      <App />
    </CtxProvider>
  </StrictMode>,
);
