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
        {modules.map((module, index) => {
          const available = module.id === "anatomy";
          const Card = available ? "a" : "div";
          return <Card key={module.id} className={`home-module home-module-${module.id}`} href={available ? `/${module.id}` : undefined} aria-disabled={available ? undefined : true}>
            <div className="home-module-art" aria-hidden="true">
              <span className="home-module-number">0{index + 1}</span>
              <img src={`/home/${module.id}.png`} alt="" width={640} height={640} decoding="async" />
            </div>
            <div className="home-module-copy">
              <strong>{t(module.title)}</strong>
              <span>{t(module.description)}</span>
            </div>
            {available ? <span className="home-module-arrow"><LineIcon name="arrow-small-right" size={18} /></span>
              : <span className="home-module-lock">{t("module.locked")}</span>}
          </Card>;
        })}
      </nav>
      <p className="home-credit"><a href="/home/ATTRIBUTION.md" target="_blank" rel="noreferrer">{t("home.imageCredit")}</a></p>
    </div>
  </main>;
}
