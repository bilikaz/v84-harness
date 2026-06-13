// Config hub — aggregates each domain (app, llm) into the main Config the app and tools read.

import { getAppConfig, type ConfigApp } from "./app.ts";
import { getConfigLLMList, type ConfigLLMList } from "./llm.ts";

export * from "./app.ts";
export * from "./llm.ts";

// The main config — every config domain under one roof, the shape tools and the app read.
export interface Config {
  app: ConfigApp;
  llm: ConfigLLMList;
}

export function getConfig(): Config {
  return { app: getAppConfig(), llm: getConfigLLMList() };
}
