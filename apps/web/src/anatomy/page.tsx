import { useEffect, useState } from "react";
import type { Catalog } from "./catalog/types";
import { getCatalog } from "./core";
import { useLanguage } from "../i18n";
import { StudyApp } from "./study-app";
import "./style.css";

export function AnatomyPage() {
  const { t } = useLanguage();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let current: Catalog | undefined;
    getCatalog().then(
      (value) => { if (active) { current = value; setCatalog(value); } else value.free(); },
      (error: unknown) => {
        console.error("Catalog initialization failed", error);
        if (active) setFailed(true);
      },
    );
    return () => { active = false; current?.free(); };
  }, []);

  if (catalog) return <StudyApp catalog={catalog} />;
  if (failed) return <main className="startup" role="alert"><h1>{t("app.startup.error.title")}</h1><p>{t("app.startup.error.body")}</p><button onClick={() => window.location.reload()}>{t("app.reload")}</button></main>;
  return <main className="startup" role="status">{t("app.startup.loading")}</main>;
}
