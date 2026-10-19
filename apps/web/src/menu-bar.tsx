import { useLanguage } from "./i18n";
import { LineIcon } from "./icons";
import { useTheme } from "./theme";
import type { GraphicsSettings } from "./viewer/graphics";
import { shortcutLabel } from "./shortcuts";

const themeOptions = ["auto", "light", "dark"] as const;

export function MenuBar({ disabled, canGoBack, canGoForward, onBack, onForward, helpId, settingsId, graphics, onGraphicsChange }: {
  disabled: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  helpId: string;
  settingsId: string;
  graphics: GraphicsSettings;
  onGraphicsChange: (settings: GraphicsSettings) => void;
}) {
  const { language, setLanguage, t } = useLanguage();
  const { theme, setTheme } = useTheme();
  return <header className="app-menu-bar" aria-label={t("app.navigation.label")}>
    <div className="app-menu-history">
      <button className="controls-info" disabled={disabled || !canGoBack} onClick={onBack}
        aria-label={t("app.back")} title={`${t("app.back")} (${shortcutLabel("back")})`}>
        <LineIcon name="arrow-small-left" size={14} />
      </button>
      <button className="controls-info" disabled={disabled || !canGoForward} onClick={onForward}
        aria-label={t("app.forward")} title={`${t("app.forward")} (${shortcutLabel("forward")})`}>
        <LineIcon name="arrow-small-right" size={14} />
      </button>
    </div>
    <h1 className="app-menu-title" title={t("app.title")}>{t("app.title")}</h1>
    <div className="app-menu-actions">
      <button className="controls-info" popoverTarget={helpId} aria-label={t("app.help")} title={`${t("app.help")} (G)`}>
        <LineIcon name="alert-circle" size={14} />
      </button>
      <button className="controls-info" popoverTarget={settingsId} aria-label={t("app.settings")} title={`${t("app.settings")} (Esc)`}>
        <LineIcon name="cog" size={14} />
      </button>
    </div>
    <section id={settingsId} className="settings-popover" popover="auto" aria-labelledby={`${settingsId}-title`}>
      <div className="guide-heading">
        <h2 id={`${settingsId}-title`}>{t("app.settings")}</h2>
        <button className="controls-info" aria-label={t("app.settings.close")} popoverTarget={settingsId} popoverTargetAction="hide">
          <LineIcon name="close-small" size={14} />
        </button>
      </div>
      <div className="settings-content">
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
        <div className="settings-row">
          <label htmlFor={`${settingsId}-shadow`}>{t("graphics.shadow.label")}</label>
          <select id={`${settingsId}-shadow`} className="settings-select" value={graphics.shadowQuality}
            onChange={event => {
              const shadowQuality = event.currentTarget.value;
              if (shadowQuality === "off" || shadowQuality === "low" || shadowQuality === "high") onGraphicsChange({ ...graphics, shadowQuality });
            }}>
            <option value="high">{t("graphics.quality.high")}</option>
            <option value="low">{t("graphics.quality.low")}</option>
            <option value="off">{t("graphics.quality.off")}</option>
          </select>
        </div>
        <div className="settings-row">
          <label htmlFor={`${settingsId}-lighting`}>{t("graphics.lighting.label")}</label>
          <select id={`${settingsId}-lighting`} className="settings-select" value={graphics.lightingQuality}
            onChange={event => {
              const lightingQuality = event.currentTarget.value;
              if (lightingQuality === "low" || lightingQuality === "high") onGraphicsChange({ ...graphics, lightingQuality });
            }}>
            <option value="high">{t("graphics.quality.high")}</option>
            <option value="low">{t("graphics.quality.low")}</option>
          </select>
        </div>
        <div className="settings-row">
          <label htmlFor={`${settingsId}-model`} title={t("graphics.model.description")}>{t("graphics.model.label")}</label>
          <select id={`${settingsId}-model`} className="settings-select" value={graphics.modelQuality}
            onChange={event => {
              const modelQuality = event.currentTarget.value;
              if (modelQuality === "low" || modelQuality === "high") onGraphicsChange({ ...graphics, modelQuality });
            }}>
            <option value="high">{t("graphics.quality.high")}</option>
            <option value="low">{t("graphics.quality.low")}</option>
          </select>
        </div>
        <div className="settings-row">
          <label htmlFor={`${settingsId}-fps`}>{t("graphics.frameRate.label")}</label>
          <select id={`${settingsId}-fps`} className="settings-select" value={graphics.frameRate}
            onChange={event => {
              const frameRate = Number(event.currentTarget.value);
              if (frameRate === 30 || frameRate === 60) onGraphicsChange({ ...graphics, frameRate });
            }}>
            <option value="60">60 FPS</option>
            <option value="30">30 FPS</option>
          </select>
        </div>
        <div className="settings-row">
          <label htmlFor={`${settingsId}-show-fps`}>{t("graphics.fps.label")}</label>
          <input id={`${settingsId}-show-fps`} className="settings-checkbox" type="checkbox" checked={graphics.showFps}
            onChange={event => onGraphicsChange({ ...graphics, showFps: event.currentTarget.checked })} />
        </div>
        <div className="settings-row">
          <label htmlFor={`${settingsId}-grid`}>{t("graphics.grid.label")}</label>
          <input id={`${settingsId}-grid`} className="settings-checkbox" type="checkbox" checked={graphics.grid}
            onChange={event => onGraphicsChange({ ...graphics, grid: event.currentTarget.checked })} />
        </div>
      </div>
    </section>
  </header>;
}
