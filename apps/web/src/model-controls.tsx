import { useEffect, useEffectEvent } from "react";
import type { MessageKey } from "./i18n";
import { useLanguage } from "./i18n";
import type { CameraCommand } from "./viewer/contracts";

const groups: { label: MessageKey; controls: { key: string; shortcut: string; label: MessageKey; action: (step: number) => CameraCommand }[] }[] = [
  { label: "controls.group.camera", controls: [
    { key: "w", shortcut: "W", label: "controls.direction.up", action: (step: number): CameraCommand => ({ kind: "pan", x: 0, y: 0.06 * step }) },
    { key: "a", shortcut: "A", label: "controls.direction.left", action: (step: number): CameraCommand => ({ kind: "pan", x: -0.06 * step, y: 0 }) },
    { key: "s", shortcut: "S", label: "controls.direction.down", action: (step: number): CameraCommand => ({ kind: "pan", x: 0, y: -0.06 * step }) },
    { key: "d", shortcut: "D", label: "controls.direction.right", action: (step: number): CameraCommand => ({ kind: "pan", x: 0.06 * step, y: 0 }) },
  ] },
  { label: "controls.group.rotate", controls: [
    { key: "arrowup", shortcut: "ArrowUp", label: "controls.direction.up", action: (step: number): CameraCommand => ({ kind: "rotate", x: 0, y: Math.PI / 8 * step }) },
    { key: "arrowleft", shortcut: "ArrowLeft", label: "controls.direction.left", action: (step: number): CameraCommand => ({ kind: "rotate", x: Math.PI / 8 * step, y: 0 }) },
    { key: "arrowdown", shortcut: "ArrowDown", label: "controls.direction.down", action: (step: number): CameraCommand => ({ kind: "rotate", x: 0, y: -Math.PI / 8 * step }) },
    { key: "arrowright", shortcut: "ArrowRight", label: "controls.direction.right", action: (step: number): CameraCommand => ({ kind: "rotate", x: -Math.PI / 8 * step, y: 0 }) },
  ] },
  { label: "controls.group.zoom", controls: [
    { key: "e", shortcut: "E", label: "controls.zoom.in", action: (step: number): CameraCommand => ({ kind: "zoom", factor: 1.2 ** -step }) },
    { key: "q", shortcut: "Q", label: "controls.zoom.out", action: (step: number): CameraCommand => ({ kind: "zoom", factor: 1.2 ** step }) },
  ] },
  { label: "controls.group.view", controls: [
    { key: "r", shortcut: "R", label: "controls.reset", action: (): CameraCommand => ({ kind: "reset" }) },
  ] },
];
const controls = groups.flatMap(group => group.controls);
const arrows: Record<string, string> = { ArrowUp: "↑", ArrowLeft: "←", ArrowDown: "↓", ArrowRight: "→" };

export function ModelControls({ disabled, onControl, helpId }: {
  disabled: boolean;
  onControl: (commands: CameraCommand[]) => boolean;
  helpId: string;
}) {
  const { t } = useLanguage();
  const run = useEffectEvent((keys: Set<string>, step: number) => onControl(controls.filter(control => keys.has(control.key)).map(control => control.action(step))));
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
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select, [role='textbox'], .app-menu-bar, .controls-guide, .catalog-panel, .information-panel"))) return;
      const key = event.key.toLowerCase();
      if (!controls.some(control => control.key === key)) return;
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
  return <div className="controls-guide" id={helpId} popover="auto" role="region" aria-label={t("controls.guide.title")}>
      <div className="guide-heading"><h2>{t("controls.guide.title")}</h2>
        <button className="controls-info" aria-label={t("controls.guide.close")} popoverTarget={helpId} popoverTargetAction="hide">×</button>
      </div>
      <div className="guide-columns">
        <section aria-label={t("controls.keyboard.label")}><h3>{t("controls.keyboard.label")}</h3>
          {groups.map(group => <div className="guide-key-group" key={group.label}>
            <h4>{t(group.label)}</h4>
            <dl>{group.controls.map(control => <div key={control.key}>
              <dt><kbd>{arrows[control.shortcut] ?? control.shortcut}</kbd></dt><dd>{t(control.label)}</dd>
            </div>)}</dl>
          </div>)}
          <p className="guide-note">{t("controls.note.holdKeys")}</p>
          <p className="guide-note">{t("controls.note.rotationCenter")}</p>
          <p className="guide-note">{t("controls.note.keyboardZoomAnchor")}</p>
        </section>
        <section aria-label={t("controls.mouse.label")}><h3>{t("controls.mouse.label")}</h3><dl className="guide-mouse">
          <div><dt>{t("controls.mouse.dragLeft")}</dt><dd>{t("controls.mouse.rotate")}</dd></div>
          <div><dt>{t("controls.mouse.wheel")}</dt><dd>{t("controls.mouse.zoomAtCursor")}</dd></div>
          <div><dt>{t("controls.mouse.panGesture")}</dt><dd>{t("controls.mouse.pan")}</dd></div>
          <div><dt>{t("controls.mouse.pointOrClick")}</dt><dd>{t("controls.mouse.showInfo")}</dd></div>
        </dl></section>
      </div>
  </div>;
}
