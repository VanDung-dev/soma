import { useLanguage } from "../i18n";
import type { CameraCommand } from "./viewer/contracts";
import { WorkspaceHelp } from "../pages/workspace-panels";
import { CameraGuide } from "../pages/camera-guide";
import { useCameraKeys } from "./use-camera-keys";
import { appShortcuts } from "../shortcuts";
import type { AppShortcut } from "../shortcuts";

export function ModelControls({ disabled, onControl, helpId, onReplayGuide }: {
  disabled: boolean;
  onControl: (commands: CameraCommand[]) => boolean;
  helpId: string;
  onReplayGuide: () => void;
}) {
  const { t } = useLanguage();
  useCameraKeys(disabled, onControl);
  return <WorkspaceHelp id={helpId}
    footer={<button className="onboarding-replay" disabled={disabled} onClick={onReplayGuide}>{t("onboarding.replay")}</button>}>
    <CameraGuide shortcuts={Object.keys(appShortcuts) as AppShortcut[]} canManipulate handCamera />
  </WorkspaceHelp>;
}
