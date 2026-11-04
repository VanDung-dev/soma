import type { MouseEventHandler, ReactNode } from "react";
import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { Menu } from "@tauri-apps/api/menu";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useLanguage } from "../i18n";
import { LineIcon } from "../icons";
import { useTheme } from "../theme";

type ModulePage = "home" | "anatomy" | "lessons" | "games";

export function ModuleLayout({ children, page, onClick }: { children: ReactNode; page: ModulePage; onClick?: MouseEventHandler<HTMLDivElement> }) {
  const tauri = isTauri();
  const suppressContextMenu = tauri && import.meta.env.DEV;
  const macOS = tauri && /Macintosh|Mac OS X/.test(navigator.userAgent);
  const windows = tauri && /Windows/.test(navigator.userAgent);
  const { language, setLanguage, t } = useLanguage();
  const { theme, setTheme } = useTheme();
  const nextTheme = theme === "auto" ? "light" : theme === "light" ? "dark" : "auto";
  const themeIcon = theme === "auto" ? "star-alt" : theme === "light" ? "sunny" : "moon-alt";
  const title = t(`module.${page}`);
  useEffect(() => { document.title = `Soma — ${title}`; }, [title]);
  useEffect(() => {
    if (!suppressContextMenu) return;
    let disposed = false;
    let menu: Menu | undefined;
    let menuPromise: Promise<Menu> | undefined;
    const popup = async (x: number, y: number) => {
      menuPromise ??= Menu.new({ items: [
        { item: "Cut" }, { item: "Copy" }, { item: "Paste" }, { item: "SelectAll" },
      ] }).then(created => {
        if (disposed) void created.close(); else menu = created;
        return created;
      });
      const contextMenu = await menuPromise;
      if (!disposed) await contextMenu.popup(new LogicalPosition(x, y));
    };
    const contextMenu = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest(".model-canvas")) return;
      event.preventDefault();
      void popup(event.clientX, event.clientY);
    };
    const frameContextMenu = (event: MessageEvent) => {
      const data = event.data;
      const frame = [...document.querySelectorAll<HTMLIFrameElement>("iframe.wikipedia-article")]
        .find(candidate => candidate.contentWindow === event.source);
      if (!frame || data?.type !== "wikipedia:contextmenu-open" || !Number.isFinite(data.x) || !Number.isFinite(data.y)) return;
      const bounds = frame.getBoundingClientRect();
      void popup(bounds.left + data.x, bounds.top + data.y);
    };
    document.addEventListener("contextmenu", contextMenu);
    window.addEventListener("message", frameContextMenu);
    return () => {
      disposed = true;
      document.removeEventListener("contextmenu", contextMenu);
      window.removeEventListener("message", frameContextMenu);
      if (menu) void menu.close();
    };
  }, [suppressContextMenu]);

  return <div className={`module-page${macOS ? " macos-window" : ""}${windows ? " windows-window" : ""}`} onClick={onClick}
    onPointerDownCapture={event => { event.currentTarget.dataset.focusSource = "pointer"; }}
    onKeyDownCapture={event => {
      if (["Tab", "Enter", " ", "Home", "End", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
        event.currentTarget.dataset.focusSource = "keyboard";
      }
    }}>
    <header className="module-header" data-tauri-drag-region={macOS || windows ? "deep" : undefined}>
      <a className="module-brand" href="/home" aria-label={t("home.brand.label")}>Soma</a>
      <nav className="module-nav" aria-label={t("app.navigation.label")}>
        <a href="/home" aria-current={page === "home" ? "page" : undefined}>{t("module.home")}</a>
        <a href="/anatomy" aria-current={page === "anatomy" ? "page" : undefined}>{t("module.anatomy")}</a>
        <a href="/lessons" aria-current={page === "lessons" ? "page" : undefined}>{t("module.lessons")}</a>
        <span className="module-nav-disabled" aria-disabled="true" aria-current={page === "games" ? "page" : undefined}>{t("module.games")}</span>
      </nav>
      <div className="module-preferences">
        <button className="page-toggle" onClick={() => setLanguage(language === "vi" ? "en" : "vi")} aria-label={t("language.selector.label")}>{language.toUpperCase()}</button>
        <button className="page-toggle theme-toggle" data-theme={theme} onClick={() => setTheme(nextTheme)} aria-label={t(`appearance.mode.${nextTheme}`)} title={t(`appearance.mode.${nextTheme}`)}><LineIcon name={themeIcon} size={18} /></button>
      </div>
      {windows && <div className="window-controls">
        <button className="window-control" aria-label={t("window.minimize")} title={t("window.minimize")} onClick={() => { void getCurrentWindow().minimize(); }}><span className="window-control-icon minimize" /></button>
        <button className="window-control" aria-label={t("window.maximizeRestore")} title={t("window.maximizeRestore")} onClick={() => { void getCurrentWindow().toggleMaximize(); }}><span className="window-control-icon maximize" /></button>
        <button className="window-control window-control-close" aria-label={t("window.close")} title={t("window.close")} onClick={() => { void getCurrentWindow().close(); }}><span className="window-control-icon close" /></button>
      </div>}
    </header>
    <div className="module-content" data-page={page}>
      <div className="model-space">{children}</div>
    </div>
  </div>;
}
