import type { ReactNode } from "react";
import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { useLanguage } from "../i18n";
import { LineIcon } from "../icons";
import { useTheme } from "../theme";

type ModulePage = "home" | "anatomy" | "lessons" | "games";

export function ModuleLayout({ children, page }: { children: ReactNode; page: ModulePage }) {
  const macOS = isTauri() && /Macintosh|Mac OS X/.test(navigator.userAgent);
  const { language, setLanguage, t } = useLanguage();
  const { theme, setTheme } = useTheme();
  const nextTheme = theme === "auto" ? "light" : theme === "light" ? "dark" : "auto";
  const themeIcon = theme === "auto" ? "star-alt" : theme === "light" ? "sunny" : "moon-alt";
  const title = t(`module.${page}`);
  useEffect(() => { document.title = `Human Atlas — ${title}`; }, [title]);

  return <div className={`module-page${macOS ? " macos-window" : ""}`}>
    <header className="module-header" data-tauri-drag-region={macOS ? "deep" : undefined}>
      <a className="module-brand" href="/home" aria-label={t("home.brand.label")}>Human Atlas</a>
      <nav className="module-nav" aria-label={t("app.navigation.label")}>
        <a href="/home" aria-current={page === "home" ? "page" : undefined}>{t("module.home")}</a>
        <a href="/anatomy" aria-current={page === "anatomy" ? "page" : undefined}>{t("module.anatomy")}</a>
        <a href="/lessons" aria-current={page === "lessons" ? "page" : undefined}>{t("module.lessons")}</a>
        <a href="/games" aria-current={page === "games" ? "page" : undefined}>{t("module.games")}</a>
      </nav>
      <div className="module-preferences">
        <button className="page-toggle" onClick={() => setLanguage(language === "vi" ? "en" : "vi")} aria-label={t("language.selector.label")}>{language.toUpperCase()}</button>
        <button className="page-toggle theme-toggle" data-theme={theme} onClick={() => setTheme(nextTheme)} aria-label={t(`appearance.mode.${nextTheme}`)} title={t(`appearance.mode.${nextTheme}`)}><LineIcon name={themeIcon} size={18} /></button>
      </div>
    </header>
    <div className="module-content" data-page={page}>
      <div className="model-space">{children}</div>
    </div>
  </div>;
}
