import { useTranslation } from "react-i18next";
import { ScrollText } from "lucide-react";

import { register } from "../../lib/registry.ts";
import { navigate, useRoute } from "../../lib/router.ts";
import { cn } from "../../lib/cn.ts";
import { ProceduresView } from "./ProceduresView.tsx";

// A menu entry that routes to the procedures view (rendered in the "main"
// region), and the view itself.
function ProceduresNav() {
  const { t } = useTranslation();
  const route = useRoute();
  const active = route === "procedures" || route.startsWith("procedures/");
  return (
    <button
      type="button"
      onClick={() => navigate("procedures")}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-neutral-200/50",
        active ? "bg-neutral-200/60 text-neutral-900" : "text-neutral-700",
      )}
    >
      <ScrollText size={17} />
      {t("nav.procedures")}
    </button>
  );
}

register(
  { region: "menu", id: "procedures", order: 3, render: () => <ProceduresNav /> },
  { region: "main", id: "procedures", route: "procedures", render: () => <ProceduresView /> },
);
