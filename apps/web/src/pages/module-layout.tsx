import type { MouseEventHandler, ReactNode } from "react";
import { createContext, useEffect, useRef } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { Menu } from "@tauri-apps/api/menu";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useLanguage } from "../i18n";
import { LineIcon } from "../icons";
import { shortcutAriaLabel, shortcutLabel, useShortcutBindings } from "../shortcuts";
import "./workspace.css";

type ModulePage = "home" | "anatomy" | "lessons" | "games" | "settings";
export const WorkspaceActiveContext = createContext(true);

export function ModuleLayout({ children, page, onClick, settings }: {
  children: ReactNode; page: ModulePage | null; onClick?: MouseEventHandler<HTMLDivElement>; settings?: ReactNode;
}) {
  const tauri = isTauri();
  const suppressContextMenu = tauri && import.meta.env.DEV;
  const macOS = tauri && /Macintosh|Mac OS X/.test(navigator.userAgent);
  const windows = tauri && /Windows/.test(navigator.userAgent);
  const { t } = useLanguage();
  useShortcutBindings();
  const settingsLink = useRef<HTMLAnchorElement>(null);
  const previousPage = useRef(page);
  const title = t(page === "settings" ? "app.settings" : page ? `module.${page}` : "app.notFound");
  useEffect(() => { document.title = `Soma — ${title}`; }, [title]);
  useEffect(() => {
    if (previousPage.current === "settings" && page !== "settings"
      && (document.activeElement === document.body || document.activeElement === null)) {
      settingsLink.current?.focus({ preventScroll: true });
    }
    previousPage.current = page;
  }, [page]);
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
        <a ref={settingsLink} className="module-settings" href="/settings" aria-current={page === "settings" ? "page" : undefined}
          aria-label={t("app.settings")} aria-keyshortcuts={shortcutAriaLabel("settings")}
          title={`${t("app.settings")}${shortcutLabel("settings") ? ` (${shortcutLabel("settings")})` : ""}`}>
          <LineIcon name="cog" size={16} />
        </a>
      </div>
      {windows && <div className="window-controls">
        <button className="window-control" aria-label={t("window.minimize")} title={t("window.minimize")} onClick={() => { void getCurrentWindow().minimize(); }}><span className="window-control-icon minimize" /></button>
        <button className="window-control" aria-label={t("window.maximizeRestore")} title={t("window.maximizeRestore")} onClick={() => { void getCurrentWindow().toggleMaximize(); }}><span className="window-control-icon maximize" /></button>
        <button className="window-control window-control-close" aria-label={t("window.close")} title={t("window.close")} onClick={() => { void getCurrentWindow().close(); }}><span className="window-control-icon close" /></button>
      </div>}
    </header>
    <div className="module-content" data-page={page}>
      <div className="model-space" inert={page === "settings"}>
        <WorkspaceActiveContext value={page !== "settings"}>{children}</WorkspaceActiveContext>
      </div>
      {settings && <div className="model-space">{settings}</div>}
    </div>
  </div>;
}
