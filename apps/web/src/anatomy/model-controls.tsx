import { useEffect, useEffectEvent } from "react";
import { useLanguage } from "../i18n";
import type { CameraCommand } from "./viewer/contracts";
import { PopoverPanel } from "../popover-panel";
import { cameraControlGroups, cameraControls, isCameraKey } from "./camera-controls";
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
  const run = useEffectEvent((keys: Set<string>, step: number) => onControl(cameraControls.filter(control => keys.has(control.key)).map(control => control.action(step))));
  useEffect(() => {
    const pressed = new Set<string>();
    let frame = 0, previous = 0;
    const stop = () => {
      pressed.clear();
      cancelAnimationFrame(frame); frame = 0;
    };
    const tick = (now: number) => {
      frame = 0;
      const keys = new Set([...pressed].filter(key => key !== "r"));
      if (!keys.size) return;
      const step = Math.max(0, Math.min((now - previous) / 1000, 0.05)) * 4;
      previous = now;
      if (step > 0 && !run(keys, step)) { stop(); return; }
      frame = requestAnimationFrame(tick);
    };
    const keyDown = (event: KeyboardEvent) => {
      if (disabled || event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      const key = event.key.toLowerCase();
      const resetCheckbox = key === "r" && target instanceof HTMLInputElement && target.type === "checkbox" && !!target.closest(".catalog-panel");
      if (!resetCheckbox && target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select, [role='textbox'], [role='menu'], .app-menu-bar, .app-popover, .catalog-panel, .information-panel"))) return;
      if (!isCameraKey(key)) return;
      event.preventDefault();
      if (pressed.has(key) || event.repeat) return;
      pressed.add(key);
      if (key === "r") run(new Set([key]), 1);
      else if (!frame) { previous = performance.now(); frame = requestAnimationFrame(tick); }
    };
    const keyUp = (event: KeyboardEvent) => {
      if (!pressed.delete(event.key.toLowerCase())) return;
      event.preventDefault();
      if (!pressed.size) { cancelAnimationFrame(frame); frame = 0; }
    };
    const visibilityChanged = () => { if (document.hidden) stop(); };
    window.addEventListener("keydown", keyDown); window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", stop); window.addEventListener("focusin", stop);
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      stop();
      window.removeEventListener("keydown", keyDown); window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", stop); window.removeEventListener("focusin", stop);
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [disabled]);
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
          </dl></section>
        </div>
  </PopoverPanel>;
}
