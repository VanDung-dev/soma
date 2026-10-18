import type { Catalog } from "./catalog/types";
import { LanguageProvider, useLanguage } from "./i18n";
import { ModelViewer } from "./model-viewer";
import { ThemeProvider } from "./theme";

export function StudyApp({ catalog }: { catalog: Catalog }) {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <StudyShell catalog={catalog} />
      </LanguageProvider>
    </ThemeProvider>
  );
}

function StudyShell({ catalog }: { catalog: Catalog }) {
  const { t } = useLanguage();
  return <div className="study-shell"
    onPointerDownCapture={event => { event.currentTarget.dataset.focusSource = "pointer"; }}
    onKeyDownCapture={event => {
      if (["Tab", "Enter", " ", "Home", "End", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
        event.currentTarget.dataset.focusSource = "keyboard";
      }
    }}>
    <a className="skip-link" href="#workspace">{t("app.skipToWorkspace")}</a>
    <ModelViewer catalog={catalog} />
  </div>;
}
