import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { Catalog } from "../anatomy/catalog/types";
import { OrientationAxes } from "../anatomy/orientation-axes";
import { ViewerStatusNotice } from "../anatomy/viewer-status";
import { useLanguage } from "../i18n";
import { LineIcon } from "../icons";
import type { Lesson, LessonStep, LessonValidationError } from "./contract";
import { lessonPreviewIssues, lessonSceneStep, lessonText, validateLessonTargets } from "./contract";
import { useLessonViewer } from "./viewer";
import { ExplodeControls } from "../anatomy/explode-controls";
import { LessonStructureTools } from "./structure-tools";
import { useLessonPanel } from "./panels";
import { lessonHtml, lessonPlainText } from "./rich-text";
import { useLessonImages } from "./image-context";
import { lessonModels } from "./targets";

export function LessonPlayer({ lesson, catalog, onBack, onEdit, preview = false }: { lesson: Lesson; catalog: Catalog; onBack: () => void; onEdit?: () => void; preview?: boolean }) {
  const { language, t } = useLanguage();
  const images = useLessonImages();
  const usesModel = lesson.steps.some(step => step.kind !== "text") && lesson.steps.some(step => step.showModel !== false);
  const modelIds = useMemo(() => lessonModels(catalog, lesson), [catalog, lesson]);
  const modelMembers = useMemo(() => [...new Set(modelIds.flatMap(id => catalog.members(id)))], [catalog, modelIds]);
  const heading = useRef<HTMLHeadingElement>(null);
  const feedback = useRef<HTMLParagraphElement>(null);
  const reader = useRef<HTMLDivElement>(null);
  const outlineId = useId();
  const [outlineOpen, setOutlineOpen] = useLessonPanel("readerOutline", false);
  const modelId = useId();
  const [modelCollapsed, setModelCollapsed] = useState(false);
  const [modelTools, setModelTools] = useState<HTMLDivElement | null>(null);
  const [index, setIndex] = useState(0);
  const [selection, setSelection] = useState<{ source: "model" | "choice"; id: string }>();
  const [incorrect, setIncorrect] = useState(false);
  const pick = useCallback((id: string) => {
    setSelection(id ? { source: "model", id } : undefined);
    setIncorrect(false);
  }, []);
  const currentStep = lesson.steps[index];
  const { host, orientation, showAxes, session, state, hold } = useLessonViewer(catalog, usesModel ? modelIds : "", pick,
    undefined, undefined, currentStep?.kind !== "identify_structure");
  const [passed, setPassed] = useState<ReadonlySet<string>>(() => new Set());
  const [failed, setFailed] = useState(false);
  const [validated, setValidated] = useState(!usesModel);
  const [complete, setComplete] = useState(false);
  const step: LessonStep = lesson.steps[index] ?? { id: "preview-empty", kind: "text", title: { vi: "", en: "" }, instruction: { vi: "", en: "" } };
  const issues = useMemo(() => preview ? lessonPreviewIssues(lesson, modelMembers, id => catalog.members(id))
    : new Map<string, LessonValidationError>(), [catalog, lesson, preview, modelMembers]);
  const issue = issues.get(step.id);
  const scene = useMemo(() => lessonSceneStep(lesson, complete ? 0 : index), [complete, index, lesson]);
  const showStepModel = usesModel && !!scene;
  const sceneIds = useMemo(() => scene ? scene.visibleIds ?? catalog.members(scene.targetId) : [], [catalog, scene]);
  const sceneUsable = useMemo(() => {
    if (!scene) return false;
    try {
      validateLessonTargets({ ...lesson, steps: [{ ...scene, kind: "observe" }] }, modelMembers, id => catalog.members(id));
      return true;
    } catch { return false; }
  }, [catalog, lesson, scene, modelMembers]);
  const exercise = step.kind === "identify_structure" ? step : undefined;
  const instruction = lessonHtml(step.instruction, language, images.urls);
  const solved = passed.has(step.id);
  const ready = validated && !state.error && !failed;
  const modelMissing = preview && modelIds.some(id => !catalog.roots.some(root => root.id === id));
  const boundary = lesson.steps.findIndex(item => item.kind === "identify_structure" && !passed.has(item.id) && !issues.has(item.id));
  const showNames = !!scene && (!exercise || solved);
  const separated = !!state.movingId || !!state.separatedIds.size;
  const choice = exercise && selection && (selection.source === "choice" ? selection.id
    : exercise.choiceIds.find(id => catalog.members(id).includes(selection.id)));

  useEffect(() => {
    if (state.building || state.error) return;
    if (preview) { setValidated(true); return; }
    try {
      validateLessonTargets(lesson, state.structureIds, id => catalog.members(id));
      setValidated(true);
    }
    catch (error) { console.error(`Lesson ${lesson.id} targets failed`, error); setFailed(true); }
  }, [catalog, lesson, preview, state.building, state.error, state.structureIds]);

  useEffect(() => {
    if (ready && scene && !session.applyScene(preview && !sceneUsable ? [] : sceneIds, sceneUsable ? scene.view : undefined)) setFailed(true);
  }, [ready, scene, sceneUsable, preview, session, sceneIds, index, complete]);

  useEffect(() => {
    if (reader.current) reader.current.scrollTop = 0;
    heading.current?.focus({ preventScroll: true });
  }, [index, complete]);

  function move(next: number) {
    if (boundary >= 0 && next > boundary) return;
    setSelection(undefined);
    setIncorrect(false);
    setComplete(false);
    setIndex(next);
    if (!next) heading.current?.focus();
  }

  return <div className="lesson-player">
    <header className="app-menu-bar lesson-player-header">
      <div className="app-menu-history">
        <button className="controls-info" onClick={onBack} aria-label={t("lessons.library")} title={t("lessons.library")}>
          <LineIcon name="arrow-small-left" size={18} />
        </button>
        <button className="lesson-button lesson-panel-toggle" aria-label={t("lessons.outline")} title={t("lessons.outline")}
          aria-controls={outlineId} aria-expanded={outlineOpen} onClick={() => setOutlineOpen()}>
          <LineIcon name="sidebar" size={18} /><span className="lesson-action-full">{t("lessons.outline")}</span>
        </button>
      </div>
      <div className="lesson-player-heading">
        <h1>{lessonText(lesson.title, language) || t("lessons.untitled")}</h1>
        <span>{preview && `${t("lessons.draftPreview")} · `}{lesson.steps.length ? t(complete ? "lessons.completed" : "lessons.step", { current: index + 1, total: lesson.steps.length }) : t("lessons.addContent")}</span>
      </div>
      <div className="app-menu-actions">
      {showStepModel && <button className="controls-info lesson-player-model-toggle" aria-controls={modelId} aria-expanded={!modelCollapsed}
        aria-label={t(modelCollapsed ? "lessons.showModel" : "lessons.hideModel")} title={t(modelCollapsed ? "lessons.showModel" : "lessons.hideModel")}
        onClick={() => setModelCollapsed(value => !value)}><LineIcon name="sidebar" size={18} /></button>}
      {onEdit && <button className="lesson-button lesson-primary" onClick={onEdit} aria-label={t("lessons.backEditor")}>
        <span className="lesson-action-full">{t("lessons.edit")}</span><span className="lesson-action-short">{t("lessons.editShort")}</span>
      </button>}
      </div>
    </header>
    <div className="lesson-player-body" data-outline={outlineOpen}>
      <nav id={outlineId} className="lesson-reader-outline workspace-panel-surface" hidden={!outlineOpen} aria-label={t("lessons.outline")}>
        <div className="lesson-outline-heading"><h2>{t("lessons.outline")}</h2>
          <button className="controls-info" aria-label={t("lessons.closeOutline")} onClick={() => {
            setOutlineOpen(false);
            document.querySelector<HTMLButtonElement>(`[aria-controls="${outlineId}"]`)?.focus();
          }}><LineIcon name="close-small" /></button>
        </div>
        <ol className="lesson-outline-list">
          {lesson.steps.map((item, i) => <li key={item.id}>
            <button className="lesson-outline-row" aria-current={!complete && i === index ? "true" : undefined}
              disabled={boundary >= 0 && i > boundary} onClick={() => move(i)}>
              <span className="lesson-block-icon" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
              <span>{lessonText(item.title, language) || t("lessons.untitledSection")}</span>
            </button>
          </li>)}
        </ol>
      </nav>
      <div className="lesson-workspace" data-model={showStepModel} data-model-collapsed={modelCollapsed}>
      {usesModel && <section className="lesson-model" id={modelId} hidden={!showStepModel} aria-label={t("viewer.section.label")}>
        <div className="lesson-model-canvas model-canvas" ref={host} aria-busy={!modelMissing && state.building && !state.error && !failed} />
        {hold && <svg key={hold.action} className="model-hold-progress" data-action={hold.action} style={{ left: hold.x, top: hold.y }} viewBox="0 0 40 40" aria-hidden="true">
          <circle cx="20" cy="20" r="16" /><circle className="model-hold-fill" cx="20" cy="20" r="16" pathLength="100" />
        </svg>}
        {showAxes && <div className="model-orientation"><OrientationAxes ref={orientation} disabled={!ready} onControl={session.control} /></div>}
        {modelMissing ? <p className="lesson-model-message model-status" role="status">{t("lessons.validation.target", { step: index + 1 })}</p>
          : failed ? <p className="lesson-model-message model-status model-error" role="alert">{t("lessons.targetError")}</p>
          : (state.building || state.error) && <ViewerStatusNotice className="lesson-model-message" state={state} totalSystems={modelIds.length} />}
        {preview && showStepModel && !state.building && !state.error && !sceneUsable && <p className="lesson-model-message model-status" role="status">{t("lessons.targetError")}</p>}
        {ready && sceneUsable && showNames && <LessonStructureTools key={scene.id} catalog={catalog} session={session} state={state} ids={sceneIds} detailsHost={modelTools} />}
        <div className="lesson-player-tools" ref={setModelTools}>
        {ready && sceneUsable && !exercise && <div className="lesson-player-explode">
          <ExplodeControls value={state.explosionAmount} disabled={separated} locked={separated} onChange={session.changeExplosion} />
          {separated && <button className="lesson-button" onClick={() => session.restoreStructure("")}>{t("context.restore")}</button>}
        </div>}
        </div>
        <button className="lesson-button lesson-player-reset" disabled={!ready || !sceneUsable} onClick={() => {
          if (!session.applyScene(sceneIds, scene?.view)) return;
          setSelection(undefined);
          setIncorrect(false);
        }}>{t("lessons.resetStudyScene")}</button>
        <a className="lesson-model-credit" href="/models/z-anatomy/ATTRIBUTION.md" target="_blank" rel="noreferrer"
          aria-label={t("credit.link")}>Z-Anatomy</a>
      </section>}
      <section className="lesson-step" aria-labelledby="lesson-step-title">
        <div className="information-content lesson-reader-body" ref={reader}>
        {complete ? <>
          <h2 id="lesson-step-title" ref={heading} tabIndex={-1}>{t("lessons.completed")}</h2>
          <button className="lesson-button" onClick={() => move(0)}>{t("lessons.review")}</button>
        </> : <>
        {lesson.steps.length > 0 && <p className="lesson-step-number">{t("lessons.step", { current: index + 1, total: lesson.steps.length })}</p>}
        <h2 id="lesson-step-title" ref={heading} tabIndex={-1}>{lessonText(step.title, language) || t(lesson.steps.length ? "lessons.untitledSection" : "lessons.addContent")}</h2>
        {issue && <p className="model-status lesson-preview-issue" role="status">{t(`lessons.validation.${issue.reason}`, { step: issue.step })}</p>}
        {lessonPlainText(step.instruction, language) || instruction.includes("<img ")
          ? <div className="lesson-instructions lesson-rich-content" dangerouslySetInnerHTML={{ __html: instruction }} />
          : <p className="lesson-instructions">{t("lessons.previewNoContent")}</p>}
        {!lesson.steps.length && <button className="lesson-button lesson-primary" onClick={onEdit ?? onBack}>{t("lessons.continueEditing")}</button>}
        {exercise && <fieldset className="lesson-choices" disabled={!ready || solved || !!issue}>
          <legend>{t("lessons.choose")}</legend>
          {exercise.choiceIds.map(id => <label key={id}>
            <input type="radio" name="lesson-choice" checked={id === (solved ? exercise.answerId : choice)}
              onChange={() => {
                session.browseStructure("");
                setSelection({ source: "choice", id });
                setIncorrect(false);
              }} />
            {catalog.target(id)?.names[language] ?? id}
          </label>)}
        </fieldset>}
        {exercise && !solved && <>
          {selection?.source === "model" && !choice && <p>{t("lessons.otherSelection")}</p>}
          <button className="lesson-button lesson-primary" disabled={!ready || !selection || !!issue} onClick={() => {
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
        </>}
        </div>
        {!complete && lesson.steps.length > 0 && <div className="lesson-actions">
          <button className="lesson-button" disabled={index === 0} onClick={() => move(index - 1)}>{t("lessons.previous")}</button>
          <button className="lesson-button lesson-primary" disabled={(showStepModel && !ready && !preview) || (!!exercise && !solved && !issue)} onClick={() => {
            if (index + 1 < lesson.steps.length) move(index + 1);
            else setComplete(true);
          }}>{t(index + 1 < lesson.steps.length ? "lessons.next" : "lessons.finish")}</button>
        </div>}
      </section>
    </div>
    </div>
  </div>;
}
