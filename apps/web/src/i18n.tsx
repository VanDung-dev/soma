import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import translations from "../../../content/ui-translations.json";
import { readSetting, writeSetting } from "./settings/storage";

export type Language = "vi" | "en";
export type MessageKey = keyof typeof translations.messages;
export type MessageValues = Record<string, string | number>;

interface LanguageContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: MessageKey, values?: MessageValues) => string;
}

export function getInitialLanguage(): Language {
  return readSetting("language") === "en" ? "en" : "vi";
}

export function translateMessage(key: MessageKey, language: Language, values: MessageValues = {}) {
  const template = translations.messages[key][language];
  const pluralized = template.replace(/\{(\w+), plural, one \{([^{}]*)\} other \{([^{}]*)\}\}/g,
    (_, name: string, one: string, other: string) => {
      const count = Number(values[name] ?? 0);
      return (language === "en" && count === 1 ? one : other).replaceAll("#", String(count));
    });
  return pluralized.replace(/\{(\w+)\}/g, (token, name: string) => String(values[name] ?? token));
}

const LanguageContext = createContext<LanguageContextValue>({
  language: "vi",
  setLanguage: () => {},
  t: (key, values) => translateMessage(key, "vi", values),
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(getInitialLanguage);
  useEffect(() => {
    document.documentElement.lang = language;
    writeSetting("language", language);
  }, [language]);
  const value = useMemo<LanguageContextValue>(() => ({
    language,
    setLanguage,
    t: (key, values) => translateMessage(key, language, values),
  }), [language]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  return useContext(LanguageContext);
}
