import { useId } from "react";
import { useLanguage } from "./i18n";
import { LineIcon } from "./icons";
import { useTheme } from "./theme";

const themeOptions = ["auto", "light", "dark"] as const;

export function MenuBar({ disabled, onBack, helpId }: {
  disabled: boolean;
  onBack: () => void;
  helpId: string;
}) {
  const settingsId = useId();
  const { language, setLanguage, t } = useLanguage();
  const { theme, setTheme } = useTheme();
  return <header className="app-menu-bar" aria-label={t("app.navigation.label")}>
    <button className="controls-info" disabled={disabled} onClick={onBack}
      aria-label={t("app.overview")} title={t("app.overview")}>
      <LineIcon name="arrow-small-left" />
    </button>
    <h1 className="app-menu-title" title={t("app.title")}>{t("app.title")}</h1>
    <div className="app-menu-actions">
      <button className="controls-info" popoverTarget={helpId} aria-label={t("app.help")} title={t("app.help")}>
        <LineIcon name="alert-circle" />
      </button>
      <button className="controls-info" popoverTarget={settingsId} aria-label={t("app.settings")} title={t("app.settings")}>
        <LineIcon name="cog" />
      </button>
    </div>
    <section id={settingsId} className="settings-popover" popover="auto" aria-labelledby={`${settingsId}-title`}>
      <div className="guide-heading">
        <h2 id={`${settingsId}-title`}>{t("app.settings")}</h2>
        <button className="controls-info" aria-label={t("app.settings.close")} popoverTarget={settingsId} popoverTargetAction="hide">
          <LineIcon name="close-small" />
        </button>
      </div>
      <div className="settings-row">
        <span>{t("language.selector.label")}</span>
        <div className="settings-language-toggle" data-language={language}>
          <span className="settings-language-option" aria-hidden="true">VI</span>
          <span className="settings-language-option" aria-hidden="true">EN</span>
          <span className="settings-language-thumb" aria-hidden="true" />
          <input className="settings-language-slider" type="range" min="0" max="1" step="1"
            aria-label={t("language.selector.label")} aria-valuetext={t(`language.option.${language}`)}
            value={language === "vi" ? 0 : 1}
            onChange={event => setLanguage(event.currentTarget.value === "0" ? "vi" : "en")} />
        </div>
      </div>
      <div className="settings-row">
        <span>{t("appearance.selector.label")}</span>
        <div className="settings-theme-control" data-theme={theme}>
          <span className="settings-theme-icon" aria-hidden="true"><LineIcon name="star-alt" size={18} /></span>
          <span className="settings-theme-icon" aria-hidden="true"><LineIcon name="sunny" size={18} /></span>
          <span className="settings-theme-icon" aria-hidden="true"><LineIcon name="moon-alt" size={18} /></span>
          <span className="settings-theme-thumb" aria-hidden="true" />
          <input className="settings-theme-slider" type="range" min="0" max="2" step="1"
            aria-label={t("appearance.selector.label")}
            aria-valuetext={t(theme === "auto" ? "appearance.mode.auto" : theme === "light" ? "appearance.mode.light" : "appearance.mode.dark")}
            value={themeOptions.indexOf(theme)}
            onChange={event => {
              const nextTheme = themeOptions[Number(event.currentTarget.value)];
              if (nextTheme) setTheme(nextTheme);
            }} />
        </div>
      </div>
    </section>
  </header>;
}
