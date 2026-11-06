import { useMemo } from "react";
import type { Catalog, StudyTarget } from "../anatomy/catalog/types";
import { StructureSearch } from "../anatomy/structure-search";
import { useLanguage } from "../i18n";
import type { Language } from "../i18n";
import { lessonText } from "./contract";
import type { Lesson, LessonStep } from "./contract";

export function LessonInspector({ catalog, lesson, active, scene, index, locale, targets, open, collapsed, onModel, onChange, onMove, onRemove }: {
  catalog: Catalog;
  lesson: Lesson;
  active?: LessonStep;
  scene?: Exclude<LessonStep, { kind: "text" }>;
  index: number;
  locale: Language;
  targets: StudyTarget[];
  open: boolean;
  collapsed: boolean;
  onModel: (id: string) => void;
  onChange: (step: LessonStep) => void;
  onMove: (offset: number) => void;
  onRemove: () => void;
}) {
  const { language, t } = useLanguage();
  return <aside className="information-panel lesson-author-inspector" id="lesson-author-inspector"
    data-open={open} data-collapsed={collapsed} inert={!open} tabIndex={-1} aria-label={t("lessons.settings")}>
    <header className="information-heading"><h2>{t("lessons.settings")}</h2></header>
    <div className="information-content lesson-fields">
      {!active && <section className="lesson-inspector-section">
        <h3>{t("lessons.required")}</h3>
        <ul className="lesson-requirements">
          <li data-complete={!!lessonText(lesson.title, locale)}>{t("lessons.requireTitle")}</li>
          <li data-complete={lesson.steps.length > 0}>{t("lessons.requireBlock")}</li>
        </ul>
      </section>}
      {active && <div className="lesson-inspector-section">
        <label className="lesson-exercise-toggle">
          <input type="checkbox" checked={active.kind === "identify_structure"} disabled={!lesson.modelId} onChange={event => {
            const exercise = event.target.checked;
            const { id, title, instruction } = active;
            const base = { id, title, instruction };
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
      </div>}
      <section className="lesson-inspector-section">
        <h3>{t("viewer.section.label")}</h3>
        <label>{t("lessons.model")}
          <select value={lesson.modelId} onChange={event => onModel(event.target.value)}>
            <option value="">{t("lessons.noModel")}</option>
            {catalog.roots.map(model => <option key={model.id} value={model.id}>{model.names[language]}</option>)}
            {lesson.modelId && !catalog.roots.some(model => model.id === lesson.modelId) &&
              <option value={lesson.modelId}>{lesson.modelId}</option>}
          </select>
        </label>
        {active && scene && catalog.roots.some(model => model.id === lesson.modelId) && <>
          <button className="lesson-button" popoverTarget="lesson-scene-structures">
            {t("lessons.sceneStructures")}
          </button>
          <p>{scene.visibleIds ? t("lessons.sceneCount", { count: scene.visibleIds.length }) : t("lessons.composeSceneHint")}</p>
        </>}
        <p>{t("lessons.sharedModel")}</p>
      </section>
      {active?.kind === "identify_structure" && <ExerciseFields catalog={catalog} targets={targets} step={active} locale={locale}
        onChange={onChange} />}
      {active && <section className="lesson-inspector-section">
        <h3>{t("lessons.arrange")}</h3>
        <div className="lesson-inspector-actions">
          <button className="lesson-button" disabled={index === 0} onClick={() => onMove(-1)}>{t("lessons.moveUp")}</button>
          <button className="lesson-button" disabled={index === lesson.steps.length - 1} onClick={() => onMove(1)}>{t("lessons.moveDown")}</button>
        </div>
        <button className="lesson-button lesson-remove-block" onClick={onRemove}>{t("lessons.removeStep")}</button>
      </section>}
    </div>
  </aside>;
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
    <StructureSearch catalog={catalog} targetIds={available} disabled={!available.length} label={t("lessons.addChoice")}
      onSelect={id => onChange({ ...step, choiceIds: [...step.choiceIds, id] })} />
    <label>{t("lessons.explanation")} ({locale.toUpperCase()})
      <textarea lang={locale} value={step.explanation[locale]} onChange={event => onChange({
        ...step, explanation: { ...step.explanation, [locale]: event.target.value },
      })} />
    </label>
  </section>;
}
