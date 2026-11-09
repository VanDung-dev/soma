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
    <div className="settings-row">
      <label htmlFor={`${id}-mode`}>{t("lessons.stepMode")}</label>
      <select id={`${id}-mode`} className="settings-select" value={mode} onChange={event => {
        const value = event.target.value as LessonMode;
        onChange(updateLessonQuestions(active, value, value !== "content" && !questions.length ? [newLessonQuestion()] : questions));
      }}>
        <option value="content">{t("lessons.mode.content")}</option>
        <option value="questions">{t("lessons.mode.questions")}</option>
        <option value="content_questions">{t("lessons.mode.contentQuestions")}</option>
      </select>
    </div>
  </section>;
}
