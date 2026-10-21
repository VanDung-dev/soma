import { useState, type MouseEvent } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { LanguageProvider } from "./i18n";
import { HomePage } from "./home/page";
import { GamesPage } from "./games/page";
import { LessonsPage } from "./lessons/page";
import { AnatomyPage } from "./anatomy/page";
import { ModuleLayout } from "./pages/module-layout";
import { ThemeProvider } from "./theme";
import { SourceDocument } from "./source-document";

function pageAtPath(pathname: string): keyof typeof pages | null {
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
  if (path === "/lessons") {
    return "lessons";
  }
  return null;
}

const pages = { home: HomePage, anatomy: AnatomyPage, lessons: LessonsPage, games: GamesPage };

function AppRoute() {
  const [page, setPage] = useState(() => pageAtPath(window.location.pathname));
  const [documentPath, setDocumentPath] = useState<string | null>(null);
  if (!page) return null;
  const Page = pages[page];
  const navigate = (event: MouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!(link instanceof HTMLAnchorElement) || link.hasAttribute("download")) return;
    const url = new URL(link.href);
    if (url.protocol !== window.location.protocol || url.host !== window.location.host || url.search || url.hash) return;
    if (url.pathname.endsWith("/ATTRIBUTION.md")) {
      event.preventDefault();
      setDocumentPath(url.pathname);
      return;
    }
    if (link.target && link.target !== "_self") return;
    const nextPage = pageAtPath(url.pathname);
    if (!nextPage) return;
    event.preventDefault();
    setPage(nextPage);
    event.currentTarget.querySelector<HTMLAnchorElement>(`.module-nav a[href="/${nextPage}"]`)?.focus({ preventScroll: true });
  };
  return <ModuleLayout page={page} onClick={isTauri() ? navigate : undefined}>
    <Page />
    {documentPath && <SourceDocument key={documentPath} path={documentPath} onClose={() => setDocumentPath(null)} />}
  </ModuleLayout>;
}

export function App() {
  return <ThemeProvider><LanguageProvider><AppRoute /></LanguageProvider></ThemeProvider>;
}
