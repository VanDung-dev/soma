import { useEffect, useRef, useState } from "react";
import type { LessonStep } from "../shared/contract";
import { lessonText } from "../shared/contract";
import { useLanguage } from "../../i18n";

type Drag = { id: string; from: number; to: number; slot: number; pointer?: number; x: number; y: number };

export function LessonOutline({ steps, selected, onSelect, onMove }: {
  steps: LessonStep[]; selected?: string; onSelect: (id: string) => void; onMove: (from: number, to: number) => void;
}) {
  const { language, t } = useLanguage();
  const list = useRef<HTMLOListElement>(null);
  const dragging = useRef<Drag | undefined>(undefined);
  const frame = useRef(0);
  const [drag, setDrag] = useState<Drag>();
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
    current.x = x;
    current.y = y;
    const bounds = list.current.parentElement!.getBoundingClientRect();
    if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return false;
    const row = [...list.current.querySelectorAll<HTMLElement>("[data-lesson-step]")].find(row => {
      const rect = row.getBoundingClientRect();
      return y >= rect.top && y <= rect.bottom;
    });
    if (!row) return false;
    const index = steps.findIndex(step => step.id === row.dataset.lessonStep);
    const rect = row.getBoundingClientRect();
    const slot = index + (y >= rect.top + rect.height / 2 ? 1 : 0);
    const to = Math.min(steps.length - 1, slot > current.from ? slot - 1 : slot);
    if (to !== current.to || slot !== current.slot) {
      dragging.current = { ...current, to, slot };
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
    const amount = current.y < bounds.top + 32 ? -8 : current.y > bounds.bottom - 32 ? 8 : 0;
    if (amount) { container.scrollTop += amount; point(current.y, current.x); }
    frame.current = requestAnimationFrame(scroll);
  }
  return <>
    <p id="lesson-drag-instructions" className="sr-only">{t("lessons.dragInstructions")}</p>
    <ol className="lesson-outline-list" ref={list} onKeyDown={event => {
      if (event.key === "Escape" && dragging.current) { event.preventDefault(); cancel(); }
    }}>
      {steps.map((step, i) => {
        const name = lessonText(step.title, language) || t("lessons.untitledSection");
        return <li key={step.id} className="lesson-outline-item" data-lesson-step={step.id}
          data-dragging={drag?.id === step.id} data-drop-before={drag && drag.to !== drag.from && drag.slot === i}
          data-drop-after={drag && drag.to !== drag.from && drag.slot === steps.length && i === steps.length - 1}>
          <button className="lesson-drag-handle" aria-label={t("lessons.dragStep", { name })}
            aria-describedby="lesson-drag-instructions" aria-pressed={drag?.id === step.id}
            onPointerDown={event => {
              if (event.button !== 0 || !event.isPrimary) return;
              event.preventDefault();
              event.currentTarget.focus({ preventScroll: true });
              event.currentTarget.setPointerCapture(event.pointerId);
              const current = { id: step.id, from: i, to: i, slot: i, pointer: event.pointerId, x: event.clientX, y: event.clientY };
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
          <button className="lesson-outline-row" aria-current={step.id === selected ? "true" : undefined} onClick={() => onSelect(step.id)}>
            <span className="lesson-block-icon" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
            <span><strong>{name}</strong>{step.kind === "identify_structure" && <small>{t("lessons.kind.identify")}</small>}</span>
          </button>
        </li>;
      })}
    </ol>
    <p className="sr-only" role="status">{drag ? t("lessons.dragPosition", { position: drag.to + 1, total: steps.length }) : ""}</p>
  </>;
}
