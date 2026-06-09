import { UserCircle, Plug, Image, Wrench } from "lucide-react";

import { register } from "../../lib/registry.ts";
import { AccountSection } from "./AccountSection.tsx";
import { ProviderSection } from "./ProviderSection.tsx";
import { MediaSection } from "./MediaSection.tsx";
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
    title: "Image generation",
    icon: Image,
    route: "settings/media",
    order: 2,
    render: () => <MediaSection />,
  },
  {
    region: "settings",
    id: "developer",
    title: "Developer",
    icon: Wrench,
    route: "settings/developer",
    order: 3,
    render: () => <DeveloperSection />,
  },
);
