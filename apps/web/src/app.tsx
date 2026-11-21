import { useEffect, useEffectEvent, useState, type MouseEvent } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { LanguageProvider } from "./i18n";
import { HomePage } from "./home/page";
import { GamesPage } from "./games/page";
import { LessonsPage } from "./lessons/page";
import { lessonEditId, lessonViewId } from "./lessons/routes";
import { AnatomyPage } from "./anatomy/page";
import { ModuleLayout } from "./pages/module-layout";
import { pageAtPath } from "./pages/routes";
import { PageMessage } from "./pages/workspace-layout";
import { ThemeProvider } from "./theme";
import { SettingsPage, settingsHref, settingsSectionAt, type SettingsSection } from "./settings/page";
import { useFontSize } from "./settings/font-size";
import { GraphicsSettingsContext, useGraphicsSettings } from "./pages/use-graphics-settings";
import { CameraDevicesContext, useCameraDevices } from "./anatomy/camera-devices";
import { shortcutAction } from "./shortcuts";

const pages = { home: HomePage, anatomy: AnatomyPage, games: GamesPage };

function AppRoute() {
  const [{ path, workspacePath, section }, setRoute] = useState(() => {
    const path = window.location.pathname;
    return { path, workspacePath: pageAtPath(path) === "settings" ? "" : path, section: settingsSectionAt(window.location.hash) };
  });
  const page = pageAtPath(path);
  const workspace = workspacePath ? pageAtPath(workspacePath) : null;
  const settings = page === "settings";
  const desktop = isTauri();
  const fontSize = useFontSize();
  const graphics = useGraphicsSettings();
  const cameras = useCameraDevices(settings || workspace === "anatomy");
  useEffect(() => {
    const sync = () => {
      const next = window.location.pathname;
      setRoute(current => ({ path: next, workspacePath: pageAtPath(next) === "settings" ? current.workspacePath : next,
        section: settingsSectionAt(window.location.hash) }));
    };
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  const goTo = (next: string, nextSection: SettingsSection = "interface") => {
    const opensSettings = pageAtPath(next) === "settings";
    if (next === path && (!opensSettings || nextSection === section)) {
      if (opensSettings) document.getElementById("settings-section-title")?.focus({ preventScroll: true });
      return;
    }
    if (!desktop) {
      if (settings && opensSettings) window.history.replaceState(window.history.state, "", settingsHref(nextSection));
      else window.history.pushState(opensSettings ? { settingsFrom: workspacePath } : null, "", opensSettings ? settingsHref(nextSection) : next);
    }
    if (opensSettings) {
      for (const popover of document.querySelectorAll<HTMLElement>('.model-space [popover="auto"]:popover-open')) popover.hidePopover();
    }
    setRoute({ path: next, workspacePath: opensSettings ? workspacePath : next, section: nextSection });
  };
  const closeSettings = () => {
    if (!desktop && window.history.state?.settingsFrom) window.history.back();
    else goTo(workspacePath || "/home");
  };
  const handleSettingsShortcut = useEffectEvent((event: KeyboardEvent) => {
    const action = shortcutAction(event);
    if (action !== "settings" || document.querySelector("dialog[open]")) return;
    event.preventDefault();
    if (settings) closeSettings();
    else goTo("/settings");
  });
  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => handleSettingsShortcut(event);
    window.addEventListener("keydown", keyDown);
    return () => window.removeEventListener("keydown", keyDown);
  }, []);
  const Page = workspace && workspace !== "lessons" && workspace !== "settings" ? pages[workspace] : null;
  const navigate = (event: MouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!(link instanceof HTMLAnchorElement) || link.hasAttribute("download")) return;
    const url = new URL(link.href);
    if (url.protocol !== window.location.protocol || url.host !== window.location.host || url.search) return;
    if (desktop && url.pathname.startsWith("/licenses/")) {
      event.preventDefault();
      void invoke("open_attribution", { path: url.pathname });
      return;
    }
    const nextPage = pageAtPath(url.pathname);
    if (url.hash && (nextPage !== "settings" || settingsSectionAt(url.hash) === "interface")) return;
    if (desktop && url.pathname.endsWith("/ATTRIBUTION.md")) {
      event.preventDefault();
      void invoke("open_attribution", { path: url.pathname });
      return;
    }
    if (link.target && link.target !== "_self") return;
    if (!nextPage || (!desktop && !settings && nextPage !== "settings")) return;
    event.preventDefault();
    if (settings && link.classList.contains("module-settings")) { closeSettings(); return; }
    goTo(url.pathname, settingsSectionAt(url.hash));
    event.currentTarget.querySelector<HTMLAnchorElement>(`.module-nav a[href="/${nextPage}"]`)?.focus({ preventScroll: true });
  };
  return <GraphicsSettingsContext value={graphics}><CameraDevicesContext value={cameras}>
    <ModuleLayout page={page} onClick={navigate} settings={settings ? <SettingsPage section={section} fontSize={fontSize} /> : undefined}>
    {Page ? <Page /> : workspace === "lessons" ? <LessonsPage editId={lessonEditId(workspacePath)} viewId={lessonViewId(workspacePath)} studyVisible={!settings} navigate={goTo} />
      : workspacePath && <PageMessage title="app.notFound" description="app.notFoundDescription" />}
    </ModuleLayout>
  </CameraDevicesContext></GraphicsSettingsContext>;
}

export function App() {
  return <ThemeProvider><LanguageProvider><AppRoute /></LanguageProvider></ThemeProvider>;
}
