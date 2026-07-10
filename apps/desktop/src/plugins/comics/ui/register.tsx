import { BookOpen } from "lucide-react";

import { register } from "../../../lib/registry.ts";
import { COMICS_SLUG } from "../manifest.ts";
import { ComicsSettingsBlock } from "./Settings.tsx";

register({
  region: "settings",
  pluginId: COMICS_SLUG,
  id: COMICS_SLUG,
  title: "Comics",
  icon: BookOpen,
  route: `settings/${COMICS_SLUG}`,
  order: 101, // plugin sections sort after the core ones
  render: () => <ComicsSettingsBlock />,
});
