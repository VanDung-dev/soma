import { useLanguage } from "../i18n";
import { LineIcon } from "../icons";
import "./style.css";

const modules = [
  { id: "anatomy", title: "module.anatomy", description: "home.anatomy.description" },
  { id: "lessons", title: "module.lessons", description: "home.pending" },
  { id: "games", title: "module.games", description: "home.pending" },
] as const;

export function HomePage() {
  const { t } = useLanguage();

  return <main className="home-page" aria-labelledby="home-title">
    <div className="home-content">
      <header className="home-heading">
        <h1 id="home-title">Human Atlas</h1>
        <p>{t("home.description")}</p>
      </header>
      <nav className="home-modules" aria-label={t("home.modules.label")}>
        {modules.map((module, index) => module.id === "anatomy" ? <a key={module.id} className={`home-module home-module-${module.id}`} href={`/${module.id}`}>
          <div className="home-module-art" aria-hidden="true">
            <span className="home-module-number">0{index + 1}</span>
            <img src={`/home/${module.id}.png`} alt="" width={640} height={640} decoding="async" />
          </div>
          <div className="home-module-copy">
            <strong>{t(module.title)}</strong>
            <span>{t(module.description)}</span>
          </div>
          <span className="home-module-arrow"><LineIcon name="arrow-small-right" size={18} /></span>
        </a> : <div key={module.id} className={`home-module home-module-${module.id}`} aria-disabled="true">
          <div className="home-module-art" aria-hidden="true">
            <span className="home-module-number">0{index + 1}</span>
            <img src={`/home/${module.id}.png`} alt="" width={640} height={640} decoding="async" />
          </div>
          <div className="home-module-copy">
            <strong>{t(module.title)}</strong>
            <span>{t(module.description)}</span>
          </div>
          <span className="home-module-lock">{t("module.locked")}</span>
        </div>)}
      </nav>
      <p className="home-credit"><a href="/home/ATTRIBUTION.md" target="_blank" rel="noreferrer">{t("home.imageCredit")}</a></p>
    </div>
  </main>;
}
