import { register } from "../../lib/registry.ts";
import { BrowserFleetPanel } from "./BrowserFleetPanel.tsx";

register({ region: "right-panel", id: "browser-fleet", order: 4, render: () => <BrowserFleetPanel /> });
