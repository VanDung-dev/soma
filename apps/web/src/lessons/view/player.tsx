import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Catalog } from "../../anatomy/catalog/types";
import { OrientationAxes } from "../../anatomy/orientation-axes";
import { ViewerStatusNotice } from "../../anatomy/viewer-status";
import { useLanguage } from "../../i18n";
import { LineIcon } from "../../icons";
import type { Lesson, LessonStep } from "../shared/contract";
import { lessonMode, lessonPreviewIssues, lessonQuestions, lessonSceneStep, lessonText, validateLessonTargets } from "../shared/contract";
import { useLessonViewer } from "../shared/viewer";
import { LessonQuestions } from "./questions";
import { useLessonPanel } from "../shared/panels";
import { lessonHtml, lessonPlainText } from "../shared/rich-text";
import { useLessonImages } from "../shared/image-context";
import { lessonModels } from "../shared/targets";
import { LessonControls } from "../shared/controls";
import { useGraphicsSettings } from "../../pages/use-graphics-settings";
import { SidebarToggle, WorkspaceLayout, WorkspaceMenu } from "../../pages/workspace-layout";

export function LessonPlayer({ lesson, catalog, onBack, onEdit, preview = false }: { lesson: Lesson; catalog: Catalog; onBack: () => void; onEdit?: () => void; preview?: boolean }) {
  const { language, t } = useLanguage();
  const [graphics, setGraphics] = useGraphicsSettings();
  const images = useLessonImages();
  const usesModel = lesson.steps.some(step => step.kind !== "text") && lesson.steps.some(step => step.showModel !== false);
  const modelIds = useMemo(() => lessonModels(catalog, lesson), [catalog, lesson]);
  const modelMembers = useMemo(() => [...new Set(modelIds.flatMap(id => catalog.members(id)))], [catalog, modelIds]);
  const heading = useRef<HTMLHeadingElement>(null);
  const reader = useRef<HTMLDivElement>(null);
  const outlineId = useId();
  const [outlineOpen, setOutlineOpen] = useLessonPanel("readerOutline", false);
  const modelId = useId();
  const [modelCollapsed, setModelCollapsed] = useState(false);
  const [index, setIndex] = useState(0);
  const { host, orientation, showAxes, fps, session, state } = useLessonViewer(catalog, graphics, usesModel ? modelIds : "", undefined,
    undefined, undefined, false, false);
  const [passed, setPassed] = useState<ReadonlySet<string>>(() => new Set());
  const [failed, setFailed] = useState(false);
  const [validated, setValidated] = useState(!usesModel);
  const [complete, setComplete] = useState(false);
  const step: LessonStep = lesson.steps[index] ?? { id: "preview-empty", kind: "text", title: { vi: "", en: "" }, instruction: { vi: "", en: "" } };
  const issues = useMemo(() => lessonPreviewIssues(lesson, modelMembers, id => catalog.members(id)), [catalog, lesson, modelMembers]);
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
  const mode = lessonMode(step);
  const questions = mode === "content" ? [] : lessonQuestions(step, id => catalog.target(id)?.names);
  const instruction = lessonHtml(step.instruction, language, images.urls);
  const solved = passed.has(step.id);
  const ready = validated && !state.error && !failed;
  const modelMissing = modelIds.some(id => !catalog.roots.some(root => root.id === id));
  const boundary = lesson.steps.findIndex(item => issues.has(item.id) || (lessonMode(item) !== "content" && !passed.has(item.id)));

  useEffect(() => {
    if (state.building || state.error) return;
    setValidated(true);
  }, [state.building, state.error]);

  useEffect(() => {
    if (ready && scene && !session.applyScene(sceneUsable ? sceneIds : [], sceneUsable ? scene.view : undefined)) setFailed(true);
  }, [ready, scene, sceneUsable, session, sceneIds, index, complete]);

  useEffect(() => {
    if (reader.current) reader.current.scrollTop = 0;
    heading.current?.focus({ preventScroll: true });
  }, [index, complete]);

  function move(next: number) {
    if (!preview && boundary >= 0 && next > boundary) return;
    setComplete(false);
    setIndex(next);
    if (!next) heading.current?.focus();
  }

  return <WorkspaceLayout className="lesson-player">
    <WorkspaceMenu className="lesson-player-header" layout="inline" navigation={<>
        <SidebarToggle controls={outlineId} expanded={outlineOpen} name={t("lessons.outline")} onToggle={() => setOutlineOpen(!outlineOpen)} />
        <button className="controls-info lesson-exit" onClick={onBack} aria-label={t("lessons.exit")} title={t("lessons.exit")}>
          <LineIcon name="arrow-small-left" size={18} />
          {t("lessons.exit")}
        </button>
      </>} title={<div className="lesson-player-heading">
        <h1>{lessonText(lesson.title, language) || t("lessons.untitled")}</h1>
        <span>{preview && `${t("lessons.draftPreview")} · `}{lesson.steps.length ? t(complete ? "lessons.completed" : "lessons.step", { current: index + 1, total: lesson.steps.length }) : t("lessons.addContent")}</span>
      </div>} actions={<>
      {showStepModel && <button className="controls-info lesson-player-model-toggle" aria-controls={modelId} aria-expanded={!modelCollapsed}
        aria-label={t(modelCollapsed ? "lessons.showModel" : "lessons.hideModel")} title={t(modelCollapsed ? "lessons.showModel" : "lessons.hideModel")}
        onClick={() => setModelCollapsed(value => !value)}><LineIcon name="sidebar" size={18} /></button>}
      {onEdit && <button className="lesson-button lesson-primary" onClick={onEdit} aria-label={t("lessons.backEditor")}>
        <span className="lesson-action-full">{t("lessons.edit")}</span><span className="lesson-action-short">{t("lessons.editShort")}</span>
      </button>}
      <LessonControls graphics={graphics} onGraphicsChange={setGraphics} />
      </>} />
    <div className="lesson-player-body" data-outline={outlineOpen}>
      <nav id={outlineId} className="lesson-reader-outline workspace-panel-surface" hidden={!outlineOpen} aria-label={t("lessons.outline")}>
        <div className="catalog-heading"><h2>{t("lessons.outline")}</h2></div>
        <div className="catalog-tree">
          <ol className="lesson-outline-list">
            {lesson.steps.map((item, i) => {
              const name = lessonText(item.title, language) || t("lessons.untitledSection");
              return <li key={item.id} className="lesson-outline-item">
                <button className="lesson-outline-row" aria-current={!complete && i === index ? "true" : undefined}
                  disabled={!preview && boundary >= 0 && i > boundary} onClick={() => move(i)}>
                  <span className="lesson-block-icon" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
                  <span><strong>{name}</strong></span>
                </button>
              </li>;
            })}
          </ol>
        </div>
      </nav>
      <div className="lesson-workspace" data-model={showStepModel} data-model-collapsed={modelCollapsed}>
      {usesModel && <section className="lesson-model" id={modelId} hidden={!showStepModel} aria-label={t("viewer.section.label")}>
        <div className="lesson-model-canvas model-canvas" ref={host} aria-busy={!modelMissing && state.building && !state.error && !failed}>
          <div className="lesson-model-tools">
            <button className="lesson-button lesson-player-reset" disabled={!ready || !sceneUsable} onClick={() => {
              if (!session.applyScene(sceneIds, scene?.view)) return;
            }}>{t("lessons.resetStudyScene")}</button>
            {graphics.showFps && <span className="model-fps" aria-label={t("graphics.fps.current", { count: fps })}>{fps} FPS</span>}
            <a className="lesson-model-credit" href="/models/z-anatomy/ATTRIBUTION.md" target="_blank" rel="noreferrer"
              aria-label={t("credit.link")}>Z-Anatomy</a>
          </div>
        </div>
        {showAxes && <div className="model-orientation"><OrientationAxes ref={orientation} disabled={!ready} onControl={session.control} /></div>}
        {modelMissing ? <p className="lesson-model-message model-status" role="status">{t("lessons.validation.target", { step: index + 1 })}</p>
          : failed ? <p className="lesson-model-message model-status model-error" role="alert">{t("lessons.targetError")}</p>
          : state.error && <ViewerStatusNotice className="lesson-model-message" state={state} totalSystems={modelIds.length} />}
        {showStepModel && !state.building && !state.error && !sceneUsable && <p className="lesson-model-message model-status" role="status">{t("lessons.targetError")}</p>}
      </section>}
      <section className="lesson-step" aria-labelledby="lesson-step-title">
        {lesson.steps.length > 0 && <div className="lesson-editor-stepbar lesson-player-stepbar">
          {!complete && <button className="lesson-button lesson-step-previous" disabled={index === 0}
            onClick={() => move(index - 1)}>{t("lessons.previous")}</button>}
          <span>{t("lessons.step", { current: index + 1, total: lesson.steps.length })}</span>
          <div className="lesson-editor-stepbar-actions">
            {complete
              ? <button className="lesson-button" onClick={() => move(0)}>{t("lessons.review")}</button>
              : <button className="lesson-button lesson-primary" disabled={!!issue && !preview || (mode !== "content" && !solved && !preview)} onClick={() => {
                if (index + 1 < lesson.steps.length) move(index + 1);
                else setComplete(true);
              }}>{t(index + 1 < lesson.steps.length ? "lessons.next" : "lessons.finish")}</button>}
          </div>
        </div>}
        <div className="information-content lesson-reader-body" ref={reader}>
        {complete ? <>
          <h2 id="lesson-step-title" ref={heading} tabIndex={-1}>{t("lessons.completed")}</h2>
        </> : <>
        <h2 id="lesson-step-title" ref={heading} tabIndex={-1}>{lessonText(step.title, language) || t(lesson.steps.length ? "lessons.untitledSection" : "lessons.addContent")}</h2>
        {issue && <p className="model-status lesson-preview-issue" role="status">{t(`lessons.validation.${issue.reason}`, { step: issue.step })}</p>}
        {mode !== "questions" && (lessonPlainText(step.instruction, language) || instruction.includes("<img ")
          ? <div className="lesson-instructions lesson-rich-content" dangerouslySetInnerHTML={{ __html: instruction }} />
          : <p className="lesson-instructions">{t("lessons.previewNoContent")}</p>)}
        {!lesson.steps.length && <button className="lesson-button lesson-primary" onClick={onEdit ?? onBack}>{t("lessons.continueEditing")}</button>}
        </>}
        <div hidden={complete}><LessonQuestions stepId={step.id} questions={questions} disabled={!!issue}
          onComplete={() => setPassed(current => new Set([...current, step.id]))} /></div>
        </div>
      </section>
    </div>
    </div>
  </WorkspaceLayout>;
}
