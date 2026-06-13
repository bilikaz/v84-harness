import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Modal } from "../../components/Modal.tsx";
import { cn } from "../../lib/cn.ts";
import { contributionsFor } from "../../lib/registry.ts";
import { navigate, useRoute } from "../../lib/router.ts";

export function SettingsModal() {
  const { t } = useTranslation();
  const route = useRoute();
  const open = route === "settings" || route.startsWith("settings/");
  const items = contributionsFor("settings");
  const activeId = route.replace(/^settings\/?/, "") || items[0]?.id;
  const active = items.find((i) => i.id === activeId) ?? items[0];

  return (
    <Modal open={open} onClose={() => navigate("")} className="flex h-[min(990px,92vh)] w-[min(1430px,95vw)] overflow-hidden">
      <aside className="flex w-64 shrink-0 flex-col gap-1 border-r border-neutral-200 bg-neutral-50 p-3">
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-sm text-neutral-400">
          <Search size={15} />
          <span>{t("settings.search")}</span>
        </div>
        <div className="px-2 pb-1 text-xs font-medium text-neutral-400">{t("settings.title")}</div>
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => navigate(item.route ?? `settings/${item.id}`)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm",
                active?.id === item.id
                  ? "bg-neutral-200/70 font-medium text-neutral-900"
                  : "text-neutral-600 hover:bg-neutral-200/40",
              )}
            >
              {Icon && <Icon size={16} />}
              {t(`${item.id}.title`, { defaultValue: item.title ?? item.id })}
            </button>
          );
        })}
      </aside>

      <section className="flex-1 overflow-y-auto px-10 py-8">{active?.render()}</section>
    </Modal>
  );
}
