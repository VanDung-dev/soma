import { useMemo } from "react";
import type { Catalog, StudyTarget } from "../anatomy/catalog/types";
import { useLanguage } from "../i18n";
import type { Language } from "../i18n";
import { lessonText } from "./contract";
import type { Lesson, LessonScene, LessonStep } from "./contract";

export function LessonStepOptions({ catalog, lesson, active, scene, locale, targets, onChange }: {
  catalog: Catalog;
  lesson: Lesson;
  active: LessonStep;
  scene?: LessonScene;
  locale: Language;
  targets: StudyTarget[];
  onChange: (step: LessonStep) => void;
}) {
  const { t } = useLanguage();
  return <section className="lesson-step-options" aria-label={t("lessons.stepOptions")}>
    <div className="lesson-fields">
      <label className="lesson-exercise-toggle">
        <input type="checkbox" checked={active.showModel !== false} disabled={active.kind === "identify_structure"}
          onChange={event => onChange({ ...active, showModel: event.target.checked })} />
        {t("lessons.stepShowModel")}
      </label>
      <div className="lesson-inspector-section">
        <label className="lesson-exercise-toggle">
          <input type="checkbox" checked={active.kind === "identify_structure"} disabled={!lesson.modelId || active.showModel === false} onChange={event => {
            const exercise = event.target.checked;
            const { id, title, instruction } = active;
            const base = { id, title, instruction, showModel: active.showModel };
            const targetId = active.kind === "text" ? scene?.targetId ?? lesson.modelId : active.targetId;
            const visibleIds = active.kind === "text" ? scene?.visibleIds : active.visibleIds;
            const view = active.kind === "text" ? scene?.view : active.view;
            const losesChoices = active.kind === "identify_structure" &&
              (active.choiceIds.length || lessonText(active.explanation, locale));
            if (losesChoices && !window.confirm(t("lessons.confirmTypeChange"))) return;
            onChange(exercise
              ? { ...base, kind: "identify_structure", targetId, visibleIds, view, choiceIds: [], answerId: "", explanation: { vi: "", en: "" } }
              : { ...base, kind: "observe", targetId, visibleIds, view });
          }} />
          {t("lessons.addExercise")}
        </label>
      </div>
      {active?.kind === "identify_structure" && <ExerciseFields catalog={catalog} targets={targets} step={active} locale={locale}
        onChange={onChange} />}
    </div>
  </section>;
}

function ExerciseFields({ catalog, targets, step, locale, onChange }: {
  catalog: Catalog;
  targets: StudyTarget[];
  step: Extract<LessonStep, { kind: "identify_structure" }>;
  locale: Language;
  onChange: (value: typeof step) => void;
}) {
  const { language, t } = useLanguage();
  const available = useMemo(() => {
    const visible = new Set(step.visibleIds ?? catalog.members(step.targetId));
    const used = new Set(step.choiceIds.flatMap(id => catalog.members(id)));
    return targets.filter(target => {
      const ids = catalog.members(target.id);
      return ids.length > 0 && ids.length < visible.size && ids.every(id => visible.has(id) && !used.has(id));
    }).map(target => target.id);
  }, [catalog, targets, step.targetId, step.visibleIds, step.choiceIds]);
  return <section className="lesson-inspector-section">
    <h3>{t("lessons.answers")}</h3>
    <p>{t("lessons.answerHint")}</p>
    {step.choiceIds.length > 0 && <fieldset className="lesson-choices">
      <legend>{t("lessons.correctAnswer")}</legend>
      {step.choiceIds.map(id => <div className="lesson-choice-row" key={id}>
        <label>
          <input type="radio" name={step.id} checked={step.answerId === id} onChange={() => onChange({ ...step, answerId: id })} />
          {catalog.target(id)?.names[language] ?? id}
        </label>
        <button type="button" className="lesson-button" onClick={() => onChange({
          ...step, choiceIds: step.choiceIds.filter(value => value !== id), answerId: step.answerId === id ? "" : step.answerId,
        })}>{t("lessons.removeChoice")}</button>
      </div>)}
    </fieldset>}
    <label>{t("lessons.addChoice")}
      <select value="" disabled={!available.length} onChange={event => {
        if (event.target.value) onChange({ ...step, choiceIds: [...step.choiceIds, event.target.value] });
      }}>
        <option value="">{t("lessons.addChoice")}</option>
        {available.map(id => <option key={id} value={id}>{catalog.target(id)?.names[language] ?? id}</option>)}
      </select>
    </label>
    <label>{t("lessons.explanation")} ({locale.toUpperCase()})
      <textarea lang={locale} value={step.explanation[locale]} onChange={event => onChange({
        ...step, explanation: { ...step.explanation, [locale]: event.target.value },
      })} />
    </label>
  </section>;
}
