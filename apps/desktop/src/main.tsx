import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App.tsx";
import "./core/init.ts"; // constructs the renderer ctx singleton (config owners + llm client) at startup
import "./index.css";
import "./lib/i18n.ts";

import.meta.glob("./pages/**/register.{ts,tsx}", { eager: true });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
