import { useLanguage } from "../i18n";
import type { CameraCommand } from "./viewer/contracts";
import { PopoverPanel } from "../popover-panel";
import { cameraControlGroups } from "./camera-controls";
import { useCameraKeys } from "./use-camera-keys";
import { appShortcuts, shortcutLabel } from "../shortcuts";
import type { AppShortcut } from "../shortcuts";

const arrows: Record<string, string> = { ArrowUp: "↑", ArrowLeft: "←", ArrowDown: "↓", ArrowRight: "→" };

export function ModelControls({ disabled, onControl, helpId, onReplayGuide }: {
  disabled: boolean;
  onControl: (commands: CameraCommand[]) => boolean;
  helpId: string;
  onReplayGuide: () => void;
}) {
  const { t } = useLanguage();
  useCameraKeys(disabled, onControl);
  return <PopoverPanel id={helpId} className="controls-guide" contentClassName="guide-content" title={t("controls.guide.title")} closeLabel={t("controls.guide.close")}
      footer={<button className="onboarding-replay" disabled={disabled} onClick={onReplayGuide}>{t("onboarding.replay")}</button>}>
        <div className="guide-columns">
          <section aria-label={t("controls.keyboard.label")}><h3>{t("controls.keyboard.label")}</h3>
            {cameraControlGroups.map(group => <div className="guide-key-group" key={group.label}>
              <h4>{t(group.label)}</h4>
              <dl>{group.controls.map(control => <div key={control.key}>
                <dt><kbd>{arrows[control.shortcut] ?? control.shortcut}</kbd></dt><dd>{t(control.label)}</dd>
              </div>)}</dl>
            </div>)}
            <div className="guide-key-group guide-app-shortcuts">
              <h4>{t("shortcuts.app")}</h4>
              <dl>{(Object.keys(appShortcuts) as AppShortcut[]).map(action => <div key={action}>
                <dt><kbd>{shortcutLabel(action)}</kbd></dt><dd>{t(appShortcuts[action].label)}</dd>
              </div>)}</dl>
            </div>
          </section>
          <section aria-label={t("controls.mouse.label")}><h3>{t("controls.mouse.label")}</h3><dl className="guide-mouse">
            <div><dt>{t("controls.mouse.dragLeft")}</dt><dd>{t("controls.mouse.rotate")}</dd></div>
            <div><dt>{t("controls.mouse.holdRight")}</dt><dd>{t("context.hide")}</dd></div>
            <div><dt>{t("controls.mouse.holdLeft")}</dt><dd>{t("context.detach")}</dd></div>
            <div><dt>{t("controls.mouse.wheel")}</dt><dd>{t("controls.mouse.zoomAtCursor")}</dd></div>
            <div><dt>{t("controls.mouse.panGesture")}</dt><dd>{t("controls.mouse.pan")}</dd></div>
            <div><dt>{t("controls.mouse.selectGesture")}</dt><dd>{t("controls.mouse.selectGroup")}</dd></div>
            <div><dt>{t("controls.mouse.click")}</dt><dd>{t("controls.mouse.showInfo")}</dd></div>
          </dl>
          <div className="guide-hand-camera">
            <h3>{t("handCamera.device.label")}</h3>
            <dl className="guide-mouse">
              <div><dt>{t("controls.hand.rightPinch")}</dt><dd>{t("controls.group.rotate")}</dd></div>
              <div><dt>{t("controls.hand.leftPinch")}</dt><dd>{t("controls.mouse.pan")}</dd></div>
              <div><dt>{t("controls.hand.bothPinch")}</dt><dd>{t("controls.hand.zoom")}</dd></div>
            </dl>
          </div></section>
        </div>
  </PopoverPanel>;
}
