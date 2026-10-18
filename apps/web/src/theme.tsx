import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

export type Theme = "auto" | "light" | "dark";

const themeStorageKey = "human-atlas-theme";
type ThemeTransition = { finished: Promise<void>; skipTransition: () => void };

export function getInitialTheme(): Theme {
  const theme = window.localStorage.getItem(themeStorageKey);
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
  const appliedTheme = useRef<"light" | "dark" | null>(null);
  const activeTransition = useRef<ThemeTransition | null>(null);
  const setTheme = useCallback((nextTheme: Theme) => {
    window.localStorage.setItem(themeStorageKey, nextTheme);
    setThemeState(nextTheme);
  }, []);
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    let transitionTimeout = 0, removeTransitionTimeout = 0, animationFrame = 0;
    const root = document.documentElement;
    const clearRevealOrigin = () => {
      for (const value of ["x", "y", "radius"]) root.style.removeProperty(`--theme-reveal-${value}`);
    };
    const applyTheme = () => {
      const effectiveTheme = getEffectiveTheme(theme);
      window.clearTimeout(transitionTimeout);
      window.clearTimeout(removeTransitionTimeout);
      activeTransition.current?.skipTransition();
      activeTransition.current = null;
      window.cancelAnimationFrame(animationFrame);
      delete root.dataset.themeTransition;
      clearRevealOrigin();
      if (appliedTheme.current === effectiveTheme) return;
      const update = () => {
        root.dataset.theme = effectiveTheme;
        document.querySelector('meta[name="theme-color"]')?.setAttribute("content", effectiveTheme === "dark" ? "#292b2a" : "#f5f2ec");
        appliedTheme.current = effectiveTheme;
      };
      if (appliedTheme.current === null || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { update(); return; }
      transitionTimeout = window.setTimeout(() => {
        const thumb = document.querySelector<HTMLElement>(".settings-theme-thumb");
        const rect = thumb?.getBoundingClientRect();
        const x = rect?.width ? rect.left + rect.width / 2 : window.innerWidth / 2;
        const y = rect?.height ? rect.top + rect.height / 2 : window.innerHeight / 2;
        root.style.setProperty("--theme-reveal-x", `${x}px`);
        root.style.setProperty("--theme-reveal-y", `${y}px`);
        root.style.setProperty("--theme-reveal-radius", `${Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))}px`);
        const startViewTransition = (document as Document & {
          startViewTransition?: (callback: () => void) => ThemeTransition;
        }).startViewTransition;
        let transition: ThemeTransition | undefined;
        try { transition = startViewTransition?.call(document, update); } catch {}
        if (transition) {
          activeTransition.current = transition;
          const clear = () => {
            if (activeTransition.current !== transition) return;
            activeTransition.current = null;
            clearRevealOrigin();
          };
          transition.finished.then(clear, clear);
          return;
        }
        clearRevealOrigin();
        root.dataset.themeTransition = "true";
        animationFrame = window.requestAnimationFrame(() => {
          animationFrame = 0;
          update();
          removeTransitionTimeout = window.setTimeout(() => delete root.dataset.themeTransition, 320);
        });
      }, 180);
    };
    applyTheme();
    const systemThemeChanged = () => { if (theme === "auto") applyTheme(); };
    mediaQuery.addEventListener("change", systemThemeChanged);
    return () => {
      mediaQuery.removeEventListener("change", systemThemeChanged);
      window.clearTimeout(transitionTimeout);
      window.clearTimeout(removeTransitionTimeout);
      window.cancelAnimationFrame(animationFrame);
      activeTransition.current?.skipTransition();
      activeTransition.current = null;
      delete root.dataset.themeTransition;
      clearRevealOrigin();
    };
  }, [theme]);
  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
