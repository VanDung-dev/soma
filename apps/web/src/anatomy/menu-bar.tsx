import { useLanguage } from "../i18n";
import { LineIcon } from "../icons";
import { shortcutLabel, useShortcutBindings } from "../shortcuts";
import { WorkspaceMenu } from "../pages/workspace-layout";
import type { ReactNode, RefObject } from "react";

export function MenuBar({ ref, disabled, canGoBack, canGoForward, onBack, onForward, cameraEnabled, cameraActive, onCameraChange,
  cameraAccessPending, catalogToggle, informationToggle }: {
  ref: RefObject<HTMLElement | null>;
  disabled: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  cameraEnabled: boolean;
  cameraActive: boolean;
  onCameraChange: (enabled: boolean) => void;
  cameraAccessPending: boolean;
  catalogToggle: ReactNode;
  informationToggle: ReactNode;
}) {
  const { t } = useLanguage();
  useShortcutBindings();
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
    </>} title={<h1 className="app-menu-title" title={t("app.title")}>{t("app.title")}</h1>} actions={informationToggle} />;
}
