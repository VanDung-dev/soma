import { useRef } from "react";
import { useLanguage } from "../i18n";
import type { GraphicsSettings } from "../viewer/graphics";

export function GraphicsControls({ id, graphics, onChange, buttons = false }: {
  id: string; graphics: GraphicsSettings; onChange: (settings: GraphicsSettings) => void; buttons?: boolean;
}) {
  const { t } = useLanguage();
  const legacyDisplay = useRef(graphics.frameRate === "display");
  return <>
        <GraphicsOptions id={`${id}-shadow`} label={t("graphics.shadow.label")} value={graphics.shadowQuality} buttons={buttons}
          options={[["off", t("graphics.quality.off")], ["low", t("graphics.quality.low")], ["high", t("graphics.quality.high")]]}
          onChange={shadowQuality => onChange({ ...graphics, shadowQuality })} />
        <GraphicsOptions id={`${id}-lighting`} label={t("graphics.lighting.label")} value={graphics.lightingQuality} buttons={buttons}
          options={[["low", t("graphics.quality.low")], ["high", t("graphics.quality.high")]]}
          onChange={lightingQuality => onChange({ ...graphics, lightingQuality })} />
        <GraphicsOptions id={`${id}-model`} label={t("graphics.model.label")} title={t("graphics.model.description")} value={graphics.modelQuality} buttons={buttons}
          options={[["low", t("graphics.quality.low")], ["high", t("graphics.quality.high")]]}
          onChange={modelQuality => onChange({ ...graphics, modelQuality })} />
        <GraphicsOptions id={`${id}-fps`} label={t("graphics.frameRate.label")} value={graphics.frameRate} buttons={buttons}
          options={[[30, "30 FPS"], [60, "60 FPS"], [120, "120 FPS"], ...(buttons && legacyDisplay.current ? [["display", t("graphics.frameRate.display")] as const] : [])]}
          onChange={frameRate => onChange({ ...graphics, frameRate })} />
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

function GraphicsOptions<T extends string | number>({ id, label, title, value, options, buttons, onChange }: {
  id: string; label: string; title?: string; value: T; options: readonly (readonly [T, string])[]; buttons: boolean; onChange: (value: T) => void;
}) {
  return <div className={`settings-row${buttons ? " graphics-options-row" : ""}`}>
    {buttons ? <span id={`${id}-label`} className="graphics-options-label" title={title}>{label}</span>
      : <label htmlFor={id} title={title}>{label}</label>}
    {buttons ? <div className="graphics-options" role="group" aria-labelledby={`${id}-label`}>
      {options.map(([option, text]) => <button key={option} type="button" className="settings-option" data-value={option} aria-pressed={value === option}
        onClick={() => { if (option !== value) onChange(option); }}>{text}</button>)}
    </div> : <select id={id} className="settings-select" value={value} onChange={event => {
      const selected = options.find(([option]) => String(option) === event.currentTarget.value);
      if (selected) onChange(selected[0]);
    }}>{options.map(([option, text]) => <option key={option} value={option}>{text}</option>)}</select>}
  </div>;
}
