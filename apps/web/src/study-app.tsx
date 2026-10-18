import type { Catalog } from "./catalog/types";
import { LanguageProvider, useLanguage } from "./i18n";
import { ModelViewer } from "./model-viewer";

export function StudyApp({ catalog }: { catalog: Catalog }) {
  return (
    <LanguageProvider>
      <StudyShell catalog={catalog} />
    </LanguageProvider>
  );
}

function StudyShell({ catalog }: { catalog: Catalog }) {
  const { t } = useLanguage();
  return <div className="study-shell">
    <a className="skip-link" href="#workspace">{t("app.skipToWorkspace")}</a>
    <ModelViewer catalog={catalog} />
  </div>;
}
