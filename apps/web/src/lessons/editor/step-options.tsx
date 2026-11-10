import { useId } from "react";
import type { Catalog } from "../../anatomy/catalog/types";
import { useLanguage } from "../../i18n";
import type { LessonMode, LessonStep } from "../shared/contract";
import { lessonMode, lessonQuestions, updateLessonQuestions } from "../shared/contract";
import { newLessonQuestion } from "./question-editor";

export function LessonStepOptions({ catalog, active, onChange }: {
  catalog: Catalog;
  active: LessonStep;
  onChange: (step: LessonStep) => void;
}) {
  const { t } = useLanguage();
  const id = useId();
  const mode = lessonMode(active);
  const questions = lessonQuestions(active, id => catalog.target(id)?.names);
  return <section className="lesson-step-options settings-content" aria-label={t("lessons.stepOptions")}>
    <div className="settings-row">
      <label htmlFor={`${id}-model`}>{t("lessons.stepShowModel")}</label>
      <span className="settings-switch-control">
        <input id={`${id}-model`} className="settings-switch" type="checkbox" checked={active.showModel !== false} onChange={event => onChange({
          ...updateLessonQuestions(active, mode, questions), showModel: event.target.checked,
        })} />
        <span className="camera-mode-switch" aria-hidden="true" />
      </span>
    </div>
    <div className="settings-row lesson-mode-row">
      <span id={`${id}-mode`}>{t("lessons.stepMode")}</span>
      <div className="lesson-mode-options" role="group" aria-labelledby={`${id}-mode`}>
        {(["content", "questions", "content_questions"] as LessonMode[]).map(value => <button key={value}
          type="button" className="lesson-button" aria-pressed={mode === value} onClick={() => {
            if (value !== mode) onChange(updateLessonQuestions(active, value, value !== "content" && !questions.length ? [newLessonQuestion()] : questions));
          }}>{t(value === "content_questions" ? "lessons.mode.contentQuestions" : value === "content" ? "lessons.mode.content" : "lessons.mode.questions")}</button>)}
      </div>
    </div>
  </section>;
}
