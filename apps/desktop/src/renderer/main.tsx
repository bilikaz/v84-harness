import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "../App.tsx";
import { isElectron } from "../electron/bridge.ts";
import "../index.css";
import "../lib/i18n.ts";

import.meta.glob("../pages/**/register.{ts,tsx}", { eager: true });

// The one place platform is chosen: run the harness init, get ctx, then render.
const { init } = isElectron()
  ? await import("../electron/init.ts")
  : await import("../web/init.ts");

const ctx = await init();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
