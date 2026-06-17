import { UserCircle, Plug, Image, Database, Wrench, Blocks, MessageSquareText } from "lucide-react";

import { register } from "../../lib/registry.ts";
import { AccountSection } from "./AccountSection.tsx";
import { ProviderSection } from "./ProviderSection.tsx";
import { ModelsSection } from "./ModelsSection.tsx";
import { StorageSection } from "./StorageSection.tsx";
import { PluginsSection } from "./PluginsSection.tsx";
import { DeveloperSection } from "./DeveloperSection.tsx";
import { SystemSection } from "./SystemSection.tsx";

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
    id: "system",
    title: "System message",
    icon: MessageSquareText,
    route: "settings/system",
    order: 2.5,
    render: () => <SystemSection />,
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
    id: "plugins",
    title: "Plugins",
    icon: Blocks,
    route: "settings/plugins",
    order: 4,
    render: () => <PluginsSection />,
  },
  {
    region: "settings",
    id: "developer",
    title: "Developer",
    icon: Wrench,
    route: "settings/developer",
    order: 5,
    render: () => <DeveloperSection />,
  },
);
