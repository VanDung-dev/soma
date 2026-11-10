import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { LessonStep } from "../shared/contract";
import { lessonText } from "../shared/contract";
import { useLanguage } from "../../i18n";

type Drag = { id: string; from: number; to: number; slot: number; pointer?: number; x: number; y: number;
  preview?: { width: number; height: number; offsetX: number; offsetY: number } };

export function LessonOutline({ steps, selected, onSelect, onMove, onRemove }: {
  steps: LessonStep[]; selected?: string; onSelect: (id: string) => void; onMove: (from: number, to: number) => void; onRemove: () => void;
}) {
  const { language, t } = useLanguage();
  const list = useRef<HTMLOListElement>(null);
  const dragging = useRef<Drag | undefined>(undefined);
  const frame = useRef(0);
  const [drag, setDrag] = useState<Drag>();
  const draggedStep = drag && steps[drag.from];
  function cancel() {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    dragging.current = undefined;
    setDrag(undefined);
  }
  useEffect(() => {
    window.addEventListener("blur", cancel);
    return () => { cancelAnimationFrame(frame.current); window.removeEventListener("blur", cancel); };
  }, []);
  function point(y: number, x: number) {
    const current = dragging.current;
    if (!current || !list.current) return false;
    const next = { ...current, x, y };
    dragging.current = next;
    setDrag(next);
    const bounds = list.current.parentElement!.getBoundingClientRect();
    if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return false;
    const rows = [...list.current.querySelectorAll<HTMLElement>("[data-lesson-step]")];
    const index = rows.findIndex(row => {
      const rect = row.getBoundingClientRect();
      return y < rect.top + rect.height / 2;
    });
    const slot = index < 0 ? rows.length : index;
    const to = Math.min(steps.length - 1, slot > current.from ? slot - 1 : slot);
    if (to !== current.to || slot !== current.slot) {
      dragging.current = { ...next, to, slot };
      setDrag(dragging.current);
    }
    return true;
  }
  function finish() {
    const current = dragging.current;
    cancel();
    if (current) onMove(current.from, current.to);
  }
  function scroll() {
    const current = dragging.current, container = list.current?.parentElement;
    if (!current || !container) return;
    const bounds = container.getBoundingClientRect();
    const amount = current.x < bounds.left || current.x > bounds.right ? 0
      : current.y < bounds.top + 32 ? -8 : current.y > bounds.bottom - 32 ? 8 : 0;
    if (amount) { container.scrollTop += amount; point(current.y, current.x); }
    frame.current = requestAnimationFrame(scroll);
  }
  return <>
    <p id="lesson-drag-instructions" className="sr-only">{t("lessons.dragInstructions")}</p>
    <ol className="lesson-outline-list" ref={list} onKeyDown={event => {
      if (event.key === "Escape" && dragging.current) { event.preventDefault(); cancel(); }
      else if ((event.key === "Delete" || event.key === "Backspace") && !event.repeat && !event.nativeEvent.isComposing
        && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && !dragging.current
        && (event.target as HTMLElement).closest<HTMLElement>("[data-lesson-step]")?.dataset.lessonStep === selected && selected) {
        event.preventDefault();
        onRemove();
      }
    }}>
      {steps.map((step, i) => {
        const name = lessonText(step.title, language) || t("lessons.untitledSection");
        return <li key={step.id} className="lesson-outline-item lesson-outline-card" data-lesson-step={step.id}
          data-selected={step.id === selected}
          data-dragging={drag?.id === step.id} data-drop-before={drag && drag.to !== drag.from && drag.slot === i}
          data-drop-after={drag && drag.to !== drag.from && drag.slot === steps.length && i === steps.length - 1}>
          <button className="lesson-drag-handle" aria-label={t("lessons.dragStep", { name })}
            aria-describedby="lesson-drag-instructions" aria-pressed={drag?.id === step.id}
            onPointerDown={event => {
              if (event.button !== 0 || !event.isPrimary) return;
              event.preventDefault();
              event.currentTarget.focus({ preventScroll: true });
              event.currentTarget.setPointerCapture(event.pointerId);
              const rect = event.currentTarget.parentElement!.getBoundingClientRect();
              const current = { id: step.id, from: i, to: i, slot: i, pointer: event.pointerId, x: event.clientX, y: event.clientY,
                preview: { width: rect.width, height: rect.height, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top } };
              dragging.current = current;
              setDrag(current);
            }}
            onPointerMove={event => {
              if (dragging.current?.pointer === event.pointerId) {
                point(event.clientY, event.clientX);
                if (!frame.current) frame.current = requestAnimationFrame(scroll);
              }
            }}
            onPointerUp={event => {
              if (dragging.current?.pointer !== event.pointerId) return;
              if (point(event.clientY, event.clientX)) finish(); else cancel();
            }} onPointerCancel={cancel} onLostPointerCapture={() => { if (dragging.current?.pointer !== undefined) cancel(); }}
            onBlur={() => { if (dragging.current?.pointer === undefined) cancel(); }}
            onKeyDown={event => {
              if (event.key === " " || event.key === "Enter") {
                event.preventDefault();
                if (dragging.current?.id === step.id) finish();
                else { const current = { id: step.id, from: i, to: i, slot: i, x: 0, y: 0 }; dragging.current = current; setDrag(current); }
              } else if (dragging.current?.id === step.id && ["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
                event.preventDefault();
                const current = dragging.current;
                const to = event.key === "Home" ? 0 : event.key === "End" ? steps.length - 1
                  : Math.max(0, Math.min(steps.length - 1, current.to + (event.key === "ArrowDown" ? 1 : -1)));
                dragging.current = { ...current, to, slot: to > current.from ? to + 1 : to };
                setDrag(dragging.current);
              }
            }}><span aria-hidden="true">⠿</span></button>
          <button className="lesson-outline-row" aria-current={step.id === selected ? "true" : undefined}
            aria-keyshortcuts={step.id === selected ? "Delete Backspace" : undefined} onClick={() => onSelect(step.id)}>
            <span className="lesson-block-icon" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
            <span><strong>{name}</strong>{step.kind === "identify_structure" && <small>{t("lessons.kind.identify")}</small>}</span>
          </button>
        </li>;
      })}
    </ol>
    {drag?.preview && draggedStep && createPortal(<div className="lesson-outline-item lesson-outline-card lesson-outline-drag-preview"
      aria-hidden="true" data-selected={draggedStep.id === selected}
      style={{ left: drag.x - drag.preview.offsetX, top: drag.y - drag.preview.offsetY, width: drag.preview.width, height: drag.preview.height }}>
      <span className="lesson-drag-handle"><span>⠿</span></span>
      <div className="lesson-outline-row">
        <span className="lesson-block-icon">{String(drag.from + 1).padStart(2, "0")}</span>
        <span><strong>{lessonText(draggedStep.title, language) || t("lessons.untitledSection")}</strong>
          {draggedStep.kind === "identify_structure" && <small>{t("lessons.kind.identify")}</small>}</span>
      </div>
    </div>, document.body)}
    <p className="sr-only" role="status">{drag ? t("lessons.dragPosition", { position: drag.to + 1, total: steps.length }) : ""}</p>
  </>;
}
