// Config hub — aggregates each domain (app, llm, plugins) into the main Config the app and tools read.

import { getAppConfig, type ConfigApp } from "./app.ts";
import { getLLMConfigList, type LLMConfigList } from "./llm.ts";
import { getPluginsConfig } from "../plugins/config.ts";
import type { PluginsConfig } from "../plugins/types.ts";

export * from "./app.ts";
export * from "./llm.ts";

// The main config — every config domain under one roof, the shape tools and the app read.
export interface Config {
  app: ConfigApp;
  llm: LLMConfigList;
  plugins: PluginsConfig;
}

export function getConfig(): Config {
  return { app: getAppConfig(), llm: getLLMConfigList(), plugins: getPluginsConfig() };
}
