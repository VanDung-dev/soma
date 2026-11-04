import { useCallback, useEffect, useRef, useState } from "react";
import type { Catalog } from "../anatomy/catalog/types";
import { OrientationAxes } from "../anatomy/orientation-axes";
import { ViewerStatusNotice } from "../anatomy/viewer-status";
import { useLanguage } from "../i18n";
import type { Lesson } from "./contract";
import { lessonText, validateLessonTargets } from "./contract";
import { useLessonViewer } from "./viewer";

export function LessonPlayer({ lesson, catalog }: { lesson: Lesson; catalog: Catalog }) {
  const { language, t } = useLanguage();
  const usesModel = lesson.steps.some(step => step.kind !== "text");
  const heading = useRef<HTMLHeadingElement>(null);
  const feedback = useRef<HTMLParagraphElement>(null);
  const [index, setIndex] = useState(0);
  const [selection, setSelection] = useState<{ source: "model" | "choice"; id: string }>();
  const [incorrect, setIncorrect] = useState(false);
  const pick = useCallback((id: string) => {
    setSelection(id ? { source: "model", id } : undefined);
    setIncorrect(false);
  }, []);
  const { host, orientation, showAxes, session, state } = useLessonViewer(catalog, usesModel ? lesson.modelId : "", pick);
  const [passed, setPassed] = useState<ReadonlySet<string>>(() => new Set());
  const [failed, setFailed] = useState(false);
  const [validated, setValidated] = useState(!usesModel);
  const [complete, setComplete] = useState(false);
  const step = lesson.steps[index]!;
  const exercise = step.kind === "identify_structure" ? step : undefined;
  const solved = passed.has(step.id);
  const ready = validated && !state.error && !failed;
  const choice = exercise && selection && (selection.source === "choice" ? selection.id
    : exercise.choiceIds.find(id => catalog.members(id).includes(selection.id)));

  useEffect(() => {
    if (state.building || state.error) return;
    try {
      validateLessonTargets(lesson, state.structureIds, id => catalog.members(id));
      setValidated(true);
    }
    catch (error) { console.error(`Lesson ${lesson.id} targets failed`, error); setFailed(true); }
  }, [catalog, lesson, state.building, state.error, state.structureIds]);

  useEffect(() => {
    if (ready && !complete && step.kind !== "text" && !session.focus([], step.targetId)) setFailed(true);
  }, [complete, ready, session, step]);

  useEffect(() => {
    if (index || complete) heading.current?.focus();
  }, [index, complete]);

  function move(next: number) {
    setSelection(undefined);
    setIncorrect(false);
    setIndex(next);
    if (!next) heading.current?.focus();
  }

  return <>
    <div className="lesson-workspace" data-model={step.kind !== "text"} hidden={complete}>
      {usesModel && <section className="lesson-model" hidden={step.kind === "text"} aria-label={t("viewer.section.label")}>
        <div className="lesson-model-canvas model-canvas" ref={host} aria-busy={state.building && !state.error && !failed} />
        {showAxes && <div className="model-orientation"><OrientationAxes ref={orientation} disabled={!ready} onControl={session.control} /></div>}
        {failed ? <p className="lesson-model-message model-status model-error" role="alert">{t("lessons.targetError")}</p>
          : (state.building || state.error) && <ViewerStatusNotice className="lesson-model-message" state={state} totalSystems={1} />}
        <a className="lesson-model-credit" href="/models/z-anatomy/ATTRIBUTION.md" target="_blank" rel="noreferrer"
          aria-label={t("credit.link")}>Z-Anatomy</a>
      </section>}
      <section className="lesson-step" aria-labelledby="lesson-step-title">
        <p className="lesson-step-number">{t("lessons.step", { current: index + 1, total: lesson.steps.length })}</p>
        <h2 id="lesson-step-title" ref={complete ? undefined : heading} tabIndex={-1}>{lessonText(step.title, language)}</h2>
        <p className="lesson-instructions">{lessonText(step.instruction, language)}</p>
        {exercise && <fieldset className="lesson-choices" disabled={!ready || solved}>
          <legend>{t("lessons.choose")}</legend>
          {exercise.choiceIds.map(id => <label key={id}>
            <input type="radio" name="lesson-choice" checked={id === (solved ? exercise.answerId : choice)}
              onChange={() => { setSelection({ source: "choice", id }); setIncorrect(false); }} />
            {catalog.target(id)?.names[language] ?? id}
          </label>)}
        </fieldset>}
        {exercise && !solved && <>
          {selection?.source === "model" && !choice && <p>{t("lessons.otherSelection")}</p>}
          <button className="lesson-button lesson-primary" disabled={!ready || !selection} onClick={() => {
            if (choice === exercise.answerId) {
              setPassed(current => new Set([...current, step.id]));
              feedback.current?.focus();
            } else setIncorrect(true);
          }}>{t("lessons.check")}</button>
        </>}
        <p className="lesson-feedback" ref={feedback} role="status" tabIndex={-1}>
          {solved && exercise ? `${t("lessons.correct")} ${lessonText(exercise.explanation, language)}`
            : incorrect ? t("lessons.incorrect") : ""}
        </p>
        <div className="lesson-actions">
          <button className="lesson-button" disabled={index === 0} onClick={() => move(index - 1)}>{t("lessons.previous")}</button>
          <button className="lesson-button lesson-primary" disabled={(step.kind !== "text" && !ready) || (!!exercise && !solved)} onClick={() => {
            if (index + 1 < lesson.steps.length) move(index + 1);
            else setComplete(true);
          }}>{t(index + 1 < lesson.steps.length ? "lessons.next" : "lessons.finish")}</button>
        </div>
      </section>
    </div>
    {complete && <h2 ref={heading} tabIndex={-1}>{t("lessons.completed")}</h2>}
  </>;
}
