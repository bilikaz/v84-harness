import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "../locales/en.json";
import lt from "../locales/lt.json";

const KEY = "v84-harness:lang";

// Merge each in-tree plugin's locales under translation.plugins.<slug>, so a plugin reads its strings
// as t("plugins.<slug>.<key>") — namespaced, collision-free, and still key-parity-checked across en/lt.
type Dict = Record<string, unknown>;
function withPluginLocales(lang: string, base: Dict): Dict {
  const mods = import.meta.glob<Dict>("../plugins/*/locales/*.json", { eager: true, import: "default" });
  const bySlug: Dict = {};
  for (const [path, dict] of Object.entries(mods)) {
    const m = /\/plugins\/([^/]+)\/locales\/([^/]+)\.json$/.exec(path);
    if (m && m[2] === lang) bySlug[m[1]] = dict;
  }
  return { ...base, plugins: { ...(base.plugins as Dict), ...bySlug } };
}

// `label` is the native name (picker); `name` is the English name (model-facing prompts).
export const LANGUAGES = [
  { code: "en", label: "English", name: "English" },
  { code: "lt", label: "Lietuvių", name: "Lithuanian" },
] as const;

function saved(): string | undefined {
  try {
    return localStorage.getItem(KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: withPluginLocales("en", en) },
    lt: { translation: withPluginLocales("lt", lt) },
  },
  lng: saved() ?? "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false }, // React already escapes
});

export function setLanguage(code: string): void {
  void i18n.changeLanguage(code);
  try {
    localStorage.setItem(KEY, code);
  } catch {
    /* ignore */
  }
}

export default i18n;
