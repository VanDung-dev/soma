import { useLanguage } from "../i18n";
import { LineIcon } from "../icons";
import type { GraphicsSettings } from "./viewer/graphics";
import { shortcutLabel } from "../shortcuts";
import { PopoverPanel } from "../popover-panel";
import type { ReactNode, RefObject } from "react";

export function MenuBar({ ref, disabled, canGoBack, canGoForward, onBack, onForward, helpId, settingsId, graphics, onGraphicsChange, cameraEnabled, cameraActive, onCameraChange,
  cameraDevices, cameraDeviceId, cameraDevicesError, onCameraDeviceChange, cameraAccessPending, onCameraAccessRequest, catalogToggle, informationToggle }: {
  ref: RefObject<HTMLElement | null>;
  disabled: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  helpId: string;
  settingsId: string;
  graphics: GraphicsSettings;
  onGraphicsChange: (settings: GraphicsSettings) => void;
  cameraEnabled: boolean;
  cameraActive: boolean;
  onCameraChange: (enabled: boolean) => void;
  cameraDevices: readonly MediaDeviceInfo[];
  cameraDeviceId: string;
  cameraDevicesError: boolean;
  onCameraDeviceChange: (deviceId: string) => void;
  cameraAccessPending: boolean;
  onCameraAccessRequest: () => void;
  catalogToggle: ReactNode;
  informationToggle: ReactNode;
}) {
  const { t } = useLanguage();
  return <header ref={ref} className="app-menu-bar" aria-label={t("app.navigation.label")}>
    <div className="app-menu-history">
      {catalogToggle}
      <button className="controls-info history-back" disabled={disabled || !canGoBack} onClick={onBack}
        aria-label={t("app.back")} title={`${t("app.back")} (${shortcutLabel("back")})`}>
        <LineIcon name="arrow-small-left" size={14} />
      </button>
      <button className="controls-info history-forward" disabled={disabled || !canGoForward} onClick={onForward}
        aria-label={t("app.forward")} title={`${t("app.forward")} (${shortcutLabel("forward")})`}>
        <LineIcon name="arrow-small-right" size={14} />
      </button>
      <button type="button" className="hand-camera-toggle" role="switch" aria-checked={cameraEnabled}
        aria-label={t("handCamera.mode")} aria-description={cameraActive ? t("handCamera.active") : undefined}
        title={cameraActive ? `${t("handCamera.mode")} · ${t("handCamera.active")}` : t("handCamera.mode")}
        data-camera-active={cameraActive} disabled={(disabled || cameraAccessPending) && !cameraEnabled}
        onClick={() => onCameraChange(!cameraEnabled)}>
        <LineIcon name="camera" size={24} /><span className="camera-mode-switch" aria-hidden="true" />
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
      {informationToggle}
    </div>
    <PopoverPanel id={settingsId} className="settings-popover" contentClassName="settings-content" title={t("app.settings.title")} closeLabel={t("app.settings.close")}>
        <div className="settings-row">
          <label htmlFor={`${settingsId}-camera`}>{t("handCamera.device.label")}</label>
          <div className="settings-camera-controls">
          {(() => {
            const hasCameraAccess = cameraEnabled || (!cameraDevicesError && cameraDevices.length > 0 && cameraDevices.every(device => !!device.label));
            return <>
              <select id={`${settingsId}-camera`} className="settings-select" value={cameraDeviceId}
                disabled={cameraDevicesError || !cameraDevices.length}
                hidden={!hasCameraAccess}
                onChange={event => onCameraDeviceChange(event.currentTarget.value)}>
                <option value="">{t("handCamera.device.default")}</option>
                {cameraDevices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>
                  {device.label || t("handCamera.device.unnamed", { number: index + 1 })}
                </option>)}
              </select>
              {!hasCameraAccess && <button type="button" className="settings-select" data-camera-access disabled={cameraAccessPending} onClick={onCameraAccessRequest}>
                {t(cameraAccessPending ? "handCamera.device.requesting" : cameraDevicesError ? "handCamera.device.retry" : "handCamera.device.allow")}
              </button>}
            </>;
          })()}
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
              if (frameRate === 30 || frameRate === 60 || frameRate === 120) onGraphicsChange({ ...graphics, frameRate });
            }}>
            <option value="30">30 FPS</option>
            <option value="60">60 FPS</option>
            <option value="120">120 FPS</option>
          </select>
        </div>
        <div className="settings-row">
          <label htmlFor={`${settingsId}-show-axes`}>{t("graphics.axes.label")}</label>
          <span className="settings-switch-control">
            <input id={`${settingsId}-show-axes`} className="settings-switch" type="checkbox" checked={graphics.showAxes}
              onChange={event => onGraphicsChange({ ...graphics, showAxes: event.currentTarget.checked })} />
            <span className="camera-mode-switch" aria-hidden="true" />
          </span>
        </div>
        <div className="settings-row">
          <label htmlFor={`${settingsId}-show-fps`}>{t("graphics.fps.label")}</label>
          <span className="settings-switch-control">
            <input id={`${settingsId}-show-fps`} className="settings-switch" type="checkbox" checked={graphics.showFps}
              onChange={event => onGraphicsChange({ ...graphics, showFps: event.currentTarget.checked })} />
            <span className="camera-mode-switch" aria-hidden="true" />
          </span>
        </div>
        <div className="settings-row">
          <label htmlFor={`${settingsId}-grid`}>{t("graphics.grid.label")}</label>
          <span className="settings-switch-control">
            <input id={`${settingsId}-grid`} className="settings-switch" type="checkbox" checked={graphics.grid}
              onChange={event => onGraphicsChange({ ...graphics, grid: event.currentTarget.checked })} />
            <span className="camera-mode-switch" aria-hidden="true" />
          </span>
        </div>
    </PopoverPanel>
  </header>;
}
