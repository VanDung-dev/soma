import { useEffect, useState, type MouseEvent } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { LanguageProvider } from "./i18n";
import { HomePage } from "./home/page";
import { GamesPage } from "./games/page";
import { LessonsPage } from "./lessons/page";
import { lessonEditId } from "./lessons/routes";
import { AnatomyPage } from "./anatomy/page";
import { ModuleLayout } from "./pages/module-layout";
import { ThemeProvider } from "./theme";
import { SourceDocument } from "./source-document";

function pageAtPath(pathname: string): keyof typeof pages | "lessons" | null {
  const path = pathname.replace(/\/+$/, "");
  if (path === "" || path === "/home") {
    return "home";
  }
  if (path === "/anatomy") {
    return "anatomy";
  }
  if (path === "/games") {
    return "games";
  }
  if (path === "/lessons" || lessonEditId(pathname)) {
    return "lessons";
  }
  return null;
}

const pages = { home: HomePage, anatomy: AnatomyPage, games: GamesPage };

function AppRoute() {
  const [path, setPath] = useState(() => window.location.pathname);
  const page = pageAtPath(path);
  const [documentPath, setDocumentPath] = useState<string | null>(null);
  useEffect(() => {
    const sync = () => setPath(window.location.pathname);
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  const goTo = (next: string) => {
    if (!isTauri() && window.location.pathname !== next) window.history.pushState(null, "", next);
    setPath(next);
  };
  if (!page) return null;
  const Page = page === "lessons" ? null : pages[page];
  const navigate = (event: MouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!(link instanceof HTMLAnchorElement) || link.hasAttribute("download")) return;
    const url = new URL(link.href);
    if (url.protocol !== window.location.protocol || url.host !== window.location.host || url.search || url.hash) return;
    if (url.pathname.endsWith("/ATTRIBUTION.md")) {
      event.preventDefault();
      void invoke("open_attribution", { path: url.pathname }).catch(() => setDocumentPath(url.pathname));
      return;
    }
    if (link.target && link.target !== "_self") return;
    const nextPage = pageAtPath(url.pathname);
    if (!nextPage) return;
    event.preventDefault();
    goTo(url.pathname);
    event.currentTarget.querySelector<HTMLAnchorElement>(`.module-nav a[href="/${nextPage}"]`)?.focus({ preventScroll: true });
  };
  return <ModuleLayout page={page} onClick={isTauri() ? navigate : undefined}>
    {Page ? <Page /> : <LessonsPage editId={lessonEditId(path)} navigate={goTo} />}
    {documentPath && <SourceDocument key={documentPath} path={documentPath} onClose={() => setDocumentPath(null)} />}
  </ModuleLayout>;
}

export function App() {
  return <ThemeProvider><LanguageProvider><AppRoute /></LanguageProvider></ThemeProvider>;
}
