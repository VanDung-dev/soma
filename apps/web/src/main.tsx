import { createRoot } from "react-dom/client";
import { App } from "./app";
import { getInitialLanguage } from "./i18n";
import { getEffectiveTheme, getInitialTheme } from "./theme";
import "./style.css";
import "./pages.css";
import "./fonts.css";

const root = createRoot(document.getElementById("root")!);
const language = getInitialLanguage();
document.documentElement.lang = language;
document.title = "Human Atlas";
const theme = getEffectiveTheme(getInitialTheme());
document.documentElement.dataset.theme = theme;
document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#292b2a" : "#f5f2ec");
root.render(<App />);
