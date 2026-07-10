import { UserCircle, Plug, Image, Database, Blocks, Settings, LayoutGrid } from "lucide-react";

import { register } from "../../lib/registry.ts";
import { AccountSection } from "./AccountSection.tsx";
import { ProviderSection } from "./ProviderSection.tsx";
import { ModelsSection } from "./ModelsSection.tsx";
import { StorageSection } from "./StorageSection.tsx";
import { PluginsSection } from "./PluginsSection.tsx";
import { SystemSection } from "./SystemSection.tsx";
import { GallerySection } from "./GallerySection.tsx";

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
    title: "Settings",
    icon: Settings,
    route: "settings/system",
    order: 2.5,
    render: () => <SystemSection />,
  },
  {
    region: "settings",
    id: "gallery",
    title: "Gallery layouts",
    icon: LayoutGrid,
    route: "settings/gallery",
    order: 2.7,
    render: () => <GallerySection />,
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
);
