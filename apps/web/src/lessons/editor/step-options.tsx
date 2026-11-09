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
  const mode = lessonMode(active);
  const questions = lessonQuestions(active, id => catalog.target(id)?.names);
  return <section className="lesson-step-options lesson-fields" aria-label={t("lessons.stepOptions")}>
    <label className="lesson-exercise-toggle">
      <input type="checkbox" checked={active.showModel !== false} onChange={event => onChange({
        ...updateLessonQuestions(active, mode, questions), showModel: event.target.checked,
      })} />
      {t("lessons.stepShowModel")}
    </label>
    <label className="lesson-exercise-mode">{t("lessons.stepMode")}
      <select aria-label={t("lessons.stepMode")} value={mode} onChange={event => {
        const value = event.target.value as LessonMode;
        onChange(updateLessonQuestions(active, value, value !== "content" && !questions.length ? [newLessonQuestion()] : questions));
      }}>
        <option value="content">{t("lessons.mode.content")}</option>
        <option value="questions">{t("lessons.mode.questions")}</option>
        <option value="content_questions">{t("lessons.mode.contentQuestions")}</option>
      </select>
    </label>
  </section>;
}
