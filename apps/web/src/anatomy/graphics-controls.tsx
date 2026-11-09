import { useLanguage } from "../i18n";
import type { GraphicsSettings } from "./viewer/graphics";

export function GraphicsControls({ id, graphics, onChange }: {
  id: string; graphics: GraphicsSettings; onChange: (settings: GraphicsSettings) => void;
}) {
  const { t } = useLanguage();
  return <>
        <div className="settings-row">
          <label htmlFor={`${id}-shadow`}>{t("graphics.shadow.label")}</label>
          <select id={`${id}-shadow`} className="settings-select" value={graphics.shadowQuality}
            onChange={event => {
              const shadowQuality = event.currentTarget.value;
              if (shadowQuality === "off" || shadowQuality === "low" || shadowQuality === "high") onChange({ ...graphics, shadowQuality });
            }}>
            <option value="high">{t("graphics.quality.high")}</option>
            <option value="low">{t("graphics.quality.low")}</option>
            <option value="off">{t("graphics.quality.off")}</option>
          </select>
        </div>
        <div className="settings-row">
          <label htmlFor={`${id}-lighting`}>{t("graphics.lighting.label")}</label>
          <select id={`${id}-lighting`} className="settings-select" value={graphics.lightingQuality}
            onChange={event => {
              const lightingQuality = event.currentTarget.value;
              if (lightingQuality === "low" || lightingQuality === "high") onChange({ ...graphics, lightingQuality });
            }}>
            <option value="high">{t("graphics.quality.high")}</option>
            <option value="low">{t("graphics.quality.low")}</option>
          </select>
        </div>
        <div className="settings-row">
          <label htmlFor={`${id}-model`} title={t("graphics.model.description")}>{t("graphics.model.label")}</label>
          <select id={`${id}-model`} className="settings-select" value={graphics.modelQuality}
            onChange={event => {
              const modelQuality = event.currentTarget.value;
              if (modelQuality === "low" || modelQuality === "high") onChange({ ...graphics, modelQuality });
            }}>
            <option value="high">{t("graphics.quality.high")}</option>
            <option value="low">{t("graphics.quality.low")}</option>
          </select>
        </div>
        <div className="settings-row">
          <label htmlFor={`${id}-fps`}>{t("graphics.frameRate.label")}</label>
          <select id={`${id}-fps`} className="settings-select" value={graphics.frameRate}
            onChange={event => {
              const frameRate = Number(event.currentTarget.value);
              if (frameRate === 30 || frameRate === 60 || frameRate === 120) onChange({ ...graphics, frameRate });
            }}>
            <option value="30">30 FPS</option>
            <option value="60">60 FPS</option>
            <option value="120">120 FPS</option>
          </select>
        </div>
        <div className="settings-row">
          <label htmlFor={`${id}-show-axes`}>{t("graphics.axes.label")}</label>
          <span className="settings-switch-control">
            <input id={`${id}-show-axes`} className="settings-switch" type="checkbox" checked={graphics.showAxes}
              onChange={event => onChange({ ...graphics, showAxes: event.currentTarget.checked })} />
            <span className="camera-mode-switch" aria-hidden="true" />
          </span>
        </div>
        <div className="settings-row">
          <label htmlFor={`${id}-show-fps`}>{t("graphics.fps.label")}</label>
          <span className="settings-switch-control">
            <input id={`${id}-show-fps`} className="settings-switch" type="checkbox" checked={graphics.showFps}
              onChange={event => onChange({ ...graphics, showFps: event.currentTarget.checked })} />
            <span className="camera-mode-switch" aria-hidden="true" />
          </span>
        </div>
        <div className="settings-row">
          <label htmlFor={`${id}-grid`}>{t("graphics.grid.label")}</label>
          <span className="settings-switch-control">
            <input id={`${id}-grid`} className="settings-switch" type="checkbox" checked={graphics.grid}
              onChange={event => onChange({ ...graphics, grid: event.currentTarget.checked })} />
            <span className="camera-mode-switch" aria-hidden="true" />
          </span>
        </div>
  </>;
}
