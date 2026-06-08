import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App.tsx";
import "./index.css";
import "./lib/i18n.ts";

// Boot the UI registry: import every pages/**/register.{ts,tsx} so each feature's
// contributions register before first render. The filesystem is the registry.
import.meta.glob("./pages/**/register.{ts,tsx}", { eager: true });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
