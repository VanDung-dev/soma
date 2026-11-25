import { useCatalog } from "./use-catalog";
import { useLanguage } from "../i18n";
import { StudyApp } from "./study-app";
import "./style.css";

export function AnatomyPage() {
  const { t } = useLanguage();
  const { catalog, failed } = useCatalog("Catalog initialization failed", { logAfterUnmount: true });

  if (catalog) return <StudyApp catalog={catalog} />;
  if (failed) return <main className="startup" role="alert"><h1>{t("app.startup.error.title")}</h1><p>{t("app.startup.error.body")}</p><button onClick={() => window.location.reload()}>{t("app.reload")}</button></main>;
  return <main className="startup" role="status">{t("app.startup.loading")}</main>;
}
