import type { Catalog } from "./catalog/types";
import { useLanguage } from "../i18n";
import { ModelViewer } from "./model-viewer";

export function StudyApp({ catalog }: { catalog: Catalog }) {
  const { t } = useLanguage();
  return <div className="study-shell">
    <a className="skip-link" href="#workspace">{t("app.skipToWorkspace")}</a>
    <ModelViewer catalog={catalog} />
  </div>;
}
