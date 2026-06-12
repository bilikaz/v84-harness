import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "../locales/en.json";
import lt from "../locales/lt.json";

// i18next setup — add a language: drop a JSON in locales/ and list it in LANGUAGES; choice persists in localStorage.
const KEY = "v84-harness:lang";

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
    en: { translation: en },
    lt: { translation: lt },
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
