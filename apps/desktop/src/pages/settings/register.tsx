// Settings feature registration: contributes one section per concern to the
// "settings" region. Nav labels are translated by id (`<id>.title`) in
// SettingsModal; the `title` here is only the untranslated fallback.
import { UserCircle, Plug, Image, Database, Wrench } from "lucide-react";

import { register } from "../../lib/registry.ts";
import { AccountSection } from "./AccountSection.tsx";
import { ProviderSection } from "./ProviderSection.tsx";
import { ModelsSection } from "./ModelsSection.tsx";
import { StorageSection } from "./StorageSection.tsx";
import { DeveloperSection } from "./DeveloperSection.tsx";

register(
  {
    region: "settings",
    id: "account",
    title: "Account",
    icon: UserCircle,
    route: "settings/account",
    order: 0,
    render: () => <AccountSection />,
  },
  {
    region: "settings",
    id: "provider",
    title: "Provider",
    icon: Plug,
    route: "settings/provider",
    order: 1,
    render: () => <ProviderSection />,
  },
  {
    region: "settings",
    id: "media",
    title: "Media models",
    icon: Image,
    route: "settings/media",
    order: 2,
    render: () => <ModelsSection />,
  },
  {
    region: "settings",
    id: "storage",
    title: "Storage",
    icon: Database,
    route: "settings/storage",
    order: 3,
    render: () => <StorageSection />,
  },
  {
    region: "settings",
    id: "developer",
    title: "Developer",
    icon: Wrench,
    route: "settings/developer",
    order: 4,
    render: () => <DeveloperSection />,
  },
);
