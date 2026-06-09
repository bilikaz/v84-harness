import { useTranslation } from "react-i18next";
import { Bot } from "lucide-react";

import { register } from "../../lib/registry.ts";
import { navigate, useRoute } from "../../lib/router.ts";
import { cn } from "../../lib/cn.ts";
import { AgentsView } from "./AgentsView.tsx";

// A menu entry that routes to the agents view (rendered in the "main" region),
// and the view itself.
function AgentsNav() {
  const { t } = useTranslation();
  const route = useRoute();
  const active = route === "agents" || route.startsWith("agents/");
  return (
    <button
      type="button"
      onClick={() => navigate("agents")}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-neutral-200/50",
        active ? "bg-neutral-200/60 text-neutral-900" : "text-neutral-700",
      )}
    >
      <Bot size={17} />
      {t("nav.agents")}
    </button>
  );
}

register(
  { region: "menu", id: "agents", order: 3, render: () => <AgentsNav /> },
  { region: "main", id: "agents", route: "agents", render: () => <AgentsView /> },
);
