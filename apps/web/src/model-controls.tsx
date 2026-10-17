import { useEffect, useEffectEvent } from "react";
import type { AnatomyViewer } from "./wasm/anatomy_wasm";

const groups = [
  { label: "Di chuyển camera", controls: [
    { key: "w", shortcut: "W", label: "Lên", action: (v: AnatomyViewer, step: number) => v.pan(0, 0.06 * step) },
    { key: "a", shortcut: "A", label: "Trái", action: (v: AnatomyViewer, step: number) => v.pan(-0.06 * step, 0) },
    { key: "s", shortcut: "S", label: "Xuống", action: (v: AnatomyViewer, step: number) => v.pan(0, -0.06 * step) },
    { key: "d", shortcut: "D", label: "Phải", action: (v: AnatomyViewer, step: number) => v.pan(0.06 * step, 0) },
  ] },
  { label: "Xoay mô hình", controls: [
    { key: "arrowup", shortcut: "ArrowUp", label: "Lên", action: (v: AnatomyViewer, step: number) => v.rotate(0, Math.PI / 8 * step) },
    { key: "arrowleft", shortcut: "ArrowLeft", label: "Trái", action: (v: AnatomyViewer, step: number) => v.rotate(Math.PI / 8 * step, 0) },
    { key: "arrowdown", shortcut: "ArrowDown", label: "Xuống", action: (v: AnatomyViewer, step: number) => v.rotate(0, -Math.PI / 8 * step) },
    { key: "arrowright", shortcut: "ArrowRight", label: "Phải", action: (v: AnatomyViewer, step: number) => v.rotate(-Math.PI / 8 * step, 0) },
  ] },
  { label: "Zoom", controls: [
    { key: "e", shortcut: "E", label: "Phóng to", action: (v: AnatomyViewer, step: number) => v.zoom(1.2 ** -step) },
    { key: "q", shortcut: "Q", label: "Thu nhỏ", action: (v: AnatomyViewer, step: number) => v.zoom(1.2 ** step) },
  ] },
  { label: "Góc nhìn", controls: [
    { key: "r", shortcut: "R", label: "Đặt lại", action: (v: AnatomyViewer) => v.inspect("reset",
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ? undefined : performance.now()) },
  ] },
];
const controls = groups.flatMap(group => group.controls);
const arrows: Record<string, string> = { ArrowUp: "↑", ArrowLeft: "←", ArrowDown: "↓", ArrowRight: "→" };

export function ModelControls({ disabled, onOperate, helpId }: {
  disabled: boolean;
  onOperate: (action: (viewer: AnatomyViewer) => void) => boolean;
  helpId: string;
}) {
  const run = useEffectEvent((keys: Set<string>, step: number) => onOperate(viewer => {
    for (const control of controls) if (keys.has(control.key)) control.action(viewer, step);
  }));
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
  return <div className="controls-guide" id={helpId} popover="auto" role="region" aria-label="Hướng dẫn điều khiển">
      <div className="guide-heading"><h2>Hướng dẫn điều khiển</h2>
        <button className="controls-info" aria-label="Đóng hướng dẫn" popoverTarget={helpId} popoverTargetAction="hide">×</button>
      </div>
      <div className="guide-columns">
        <section aria-label="Bàn phím"><h3>Bàn phím</h3>
          {groups.map(group => <div className="guide-key-group" key={group.label}>
            <h4>{group.label}</h4>
            <dl>{group.controls.map(control => <div key={control.key}>
              <dt><kbd>{arrows[control.shortcut] ?? control.shortcut}</kbd></dt><dd>{control.label}</dd>
            </div>)}</dl>
          </div>)}
          <p className="guide-note">Giữ phím để điều khiển liên tục. Có thể dùng nhiều phím cùng lúc.</p>
          <p className="guide-note">Tâm xoay nằm tại mô hình hoặc bộ phận đang được tập trung.</p>
          <p className="guide-note">E/Q phóng to, thu nhỏ theo tâm màn hình.</p>
        </section>
        <section aria-label="Chuột"><h3>Chuột</h3><dl className="guide-mouse">
          <div><dt>Kéo chuột trái</dt><dd>Xoay mô hình</dd></div>
          <div><dt>Cuộn chuột</dt><dd>Phóng to hoặc thu nhỏ theo vị trí chuột</dd></div>
          <div><dt>Shift + kéo / kéo chuột phải</dt><dd>Dịch mô hình trên màn hình</dd></div>
          <div><dt>Trỏ hoặc nhấn vào bộ phận</dt><dd>Xem thông tin giải phẫu</dd></div>
        </dl></section>
      </div>
  </div>;
}
