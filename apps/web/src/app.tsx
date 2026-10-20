import { LanguageProvider } from "./i18n";
import { HomePage } from "./home/page";
import { GamesPage } from "./games/page";
import { LessonsPage } from "./lessons/page";
import { AnatomyPage } from "./anatomy/page";
import { ModuleLayout } from "./pages/module-layout";
import { ThemeProvider } from "./theme";

function AppRoute() {
  const path = window.location.pathname.replace(/\/+$/, "");
  if (path === "" || path === "/home") {
    return <ModuleLayout page="home"><HomePage /></ModuleLayout>;
  }
  if (path === "/anatomy") {
    return <ModuleLayout page="anatomy"><AnatomyPage /></ModuleLayout>;
  }
  if (path === "/games") {
    return <ModuleLayout page="games"><GamesPage /></ModuleLayout>;
  }
  if (path === "/lessons") {
    return <ModuleLayout page="lessons"><LessonsPage /></ModuleLayout>;
  }
  return null;
}

export function App() {
  return <ThemeProvider><LanguageProvider><AppRoute /></LanguageProvider></ThemeProvider>;
}
