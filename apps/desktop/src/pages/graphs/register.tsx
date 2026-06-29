import { register } from "../../lib/registry.ts";
import { GraphsPanel } from "./GraphsPanel.tsx";

// The Flows block sits below Agents / Browser windows in the right panel.
register({ region: "right-panel", id: "graphs", order: 5, render: () => <GraphsPanel /> });
