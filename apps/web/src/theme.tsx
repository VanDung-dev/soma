import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { readSetting, writeSetting } from "./settings/storage";

export type Theme = "auto" | "light" | "dark";

export function getInitialTheme(): Theme {
  const theme = readSetting("theme");
  return theme === "light" || theme === "dark" ? theme : "auto";
}

export function getEffectiveTheme(theme: Theme): "light" | "dark" {
  return theme === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : theme === "dark" ? "dark" : "light";
}

const ThemeContext = createContext<{ theme: Theme; setTheme: (theme: Theme) => void }>({
  theme: "light",
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);
  const setTheme = useCallback((nextTheme: Theme) => {
    writeSetting("theme", nextTheme);
    setThemeState(nextTheme);
  }, []);
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const effectiveTheme = getEffectiveTheme(theme);
      document.documentElement.dataset.theme = effectiveTheme;
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", effectiveTheme === "dark" ? "#292b2a" : "#f5f2ec");
    };
    applyTheme();
    if (theme === "auto") {
      mediaQuery.addEventListener("change", applyTheme);
      return () => mediaQuery.removeEventListener("change", applyTheme);
    }
  }, [theme]);
  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
