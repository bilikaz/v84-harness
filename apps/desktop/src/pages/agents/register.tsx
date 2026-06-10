import { useRoute } from "../../lib/router.ts";
import { register } from "../../lib/registry.ts";
import { AgentsPanel } from "./AgentsPanel.tsx";
import { AgentRunView } from "./AgentRunView.tsx";
import { AgentEditView } from "./AgentEditView.tsx";

// Agents contribute the right-panel library list and the main-region routes:
//   agents/<id>       — primed run page (a pseudo session; send materializes it)
//   agents/<id>/edit  — the playbook editor
function AgentsRoute() {
  const route = useRoute();
  const [, id, mode] = route.split("/");
  if (!id) return null; // bare "agents" — nothing selected; the panel is the entry point
  return mode === "edit" ? <AgentEditView id={id} /> : <AgentRunView id={id} />;
}

register(
  { region: "right-panel", id: "agents", order: 1, render: () => <AgentsPanel /> },
  { region: "main", id: "agents", route: "agents", render: () => <AgentsRoute /> },
);
