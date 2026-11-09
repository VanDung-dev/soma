import { useLanguage } from "../i18n";
import { LineIcon } from "../icons";
import { shortcutLabel } from "../shortcuts";
import type { GraphicsSettings } from "./viewer/graphics";
import { WorkspaceMenu } from "../pages/workspace-layout";
import { WorkspacePopoverButton, WorkspaceSettings } from "../pages/workspace-panels";
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
  return <WorkspaceMenu ref={ref} navigation={<>
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
    </>} title={<h1 className="app-menu-title" title={t("app.title")}>{t("app.title")}</h1>} actions={<>
      <WorkspacePopoverButton target={helpId} action="guide" />
      <WorkspacePopoverButton target={settingsId} action="settings" />
      {informationToggle}
    </>}>
    <WorkspaceSettings id={settingsId} graphics={graphics} onChange={onGraphicsChange}>
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
    </WorkspaceSettings>
  </WorkspaceMenu>;
}
