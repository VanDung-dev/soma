import { useEffect, useEffectEvent } from "react";
import type { RefObject } from "react";
import { cameraControls, isCameraKey } from "./camera-controls";
import type { CameraCommand } from "./viewer/contracts";

export function useCameraKeys(disabled: boolean, onControl: (commands: CameraCommand[]) => boolean, scope?: RefObject<HTMLElement | null>) {
  const run = useEffectEvent((keys: Set<string>, step: number) => onControl(cameraControls.filter(control => keys.has(control.key)).map(control => control.action(step))));
  useEffect(() => {
    if (disabled) return;
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
      if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (scope && (!(target instanceof Node) || !scope.current?.contains(target))) return;
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
  }, [disabled, scope]);
}
