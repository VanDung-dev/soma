import { useEffect, useId } from "react";
import type { GraphicsSettings } from "../../anatomy/viewer/graphics";
import { useLanguage } from "../../i18n";
import { shortcutAction } from "../../shortcuts";
import { CameraGuide } from "../../pages/camera-guide";
import { WorkspaceHelp, WorkspacePopoverButton, WorkspaceSettings } from "../../pages/workspace-panels";

export function LessonControls({ graphics, onGraphicsChange, editing = false }: {
  graphics: GraphicsSettings; onGraphicsChange: (settings: GraphicsSettings) => void; editing?: boolean;
}) {
  const { t } = useLanguage();
  const helpId = useId();
  const settingsId = useId();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = shortcutAction(event);
      if ((action !== "guide" && action !== "settings") || document.querySelector(":popover-open, dialog[open]")) return;
      event.preventDefault();
      document.getElementById(action === "guide" ? helpId : settingsId)?.showPopover();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [helpId, settingsId]);
  return <>
    <WorkspacePopoverButton target={helpId} action="guide" />
    <WorkspacePopoverButton target={settingsId} action="settings" />
    <WorkspaceSettings id={settingsId} graphics={graphics} onChange={onGraphicsChange} />
    <WorkspaceHelp id={helpId}>
      <p>{t(editing ? "lessons.guide.editor" : "lessons.guide.reader")}</p>
      {editing && <p>{t("lessons.dragInstructions")}</p>}
      <p>{t("lessons.guide.cameraFocus")}</p>
      <CameraGuide shortcuts={["guide", "settings"]} canManipulate={editing} />
    </WorkspaceHelp>
  </>;
}
