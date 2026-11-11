import { createRoot } from "react-dom/client";
import { App } from "./app";
import { getInitialLanguage } from "./i18n";
import { getEffectiveTheme, getInitialTheme } from "./theme";
import { loadSettings } from "./settings/storage";
import { initializeShortcuts } from "./shortcuts";
import "./style.css";
import "./pages.css";
import "./fonts.css";

void loadSettings().then(() => {
  initializeShortcuts();
  document.documentElement.lang = getInitialLanguage();
  document.title = "Soma";
  const theme = getEffectiveTheme(getInitialTheme());
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#292b2a" : "#f5f2ec");
  createRoot(document.getElementById("root")!).render(<App />);
});
