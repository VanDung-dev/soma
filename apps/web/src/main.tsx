import { createRoot } from "react-dom/client";
import { StudyApp } from "./study-app";
import { getCatalog } from "./core";
import { getInitialLanguage, translateMessage } from "./i18n";
import { getEffectiveTheme, getInitialTheme } from "./theme";
import "./style.css";

const root = createRoot(document.getElementById("root")!);
const language = getInitialLanguage();
document.documentElement.lang = language;
document.title = translateMessage("app.title", language);
const theme = getEffectiveTheme(getInitialTheme());
document.documentElement.dataset.theme = theme;
document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#292b2a" : "#f5f2ec");
root.render(<main className="startup" role="status">{translateMessage("app.startup.loading", language)}</main>);

getCatalog().then(
  (catalog) => root.render(<StudyApp catalog={catalog} />),
  (error: unknown) => {
    console.error("Catalog initialization failed", error);
    root.render(
      <main className="startup" role="alert">
        <h1>{translateMessage("app.startup.error.title", language)}</h1>
        <p>{translateMessage("app.startup.error.body", language)}</p>
        <button onClick={() => window.location.reload()}>{translateMessage("app.reload", language)}</button>
      </main>,
    );
  },
);
