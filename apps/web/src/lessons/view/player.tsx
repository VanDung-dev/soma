import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Catalog } from "../../anatomy/catalog/types";
import { OrientationAxes } from "../../anatomy/orientation-axes";
import { ViewerStatusNotice } from "../../anatomy/viewer-status";
import { useLanguage } from "../../i18n";
import { LineIcon } from "../../icons";
import type { Lesson, LessonStep } from "../shared/contract";
import { lessonMode, lessonPreviewIssues, lessonSceneStep, lessonText, validateLessonTargets } from "../shared/contract";
import { useLessonViewer } from "../shared/viewer";
import { LessonQuestions } from "./questions";
import { useLessonPanel } from "../shared/panels";
import { lessonHtml, lessonPlainText } from "../shared/rich-text";
import { useLessonImages } from "../shared/image-context";
import { LessonTimestamps } from "../shared/timestamps";
import { lessonModels } from "../shared/targets";
import { useGraphicsSettings } from "../../pages/use-graphics-settings";
import { SidebarToggle, WorkspaceLayout, WorkspaceMenu } from "../../pages/workspace-layout";
import { useLessonProgress } from "./progress";
import { READING_DURATION_MS, useReadingTimer } from "./reading-timer";

export function LessonPlayer({ lesson, catalog, onBack, onEdit, preview = false, initialStepId, studyVisible = true }: {
  lesson: Lesson;
  catalog: Catalog;
  onBack: () => void;
  onEdit?: () => void;
  preview?: boolean;
  initialStepId?: string;
  studyVisible?: boolean;
}) {
  const { language, t } = useLanguage();
  const [graphics] = useGraphicsSettings();
  const images = useLessonImages();
  const usesModel = lesson.steps.some(step => step.kind !== "text") && lesson.steps.some(step => step.showModel !== false);
  const modelIds = useMemo(() => lessonModels(catalog, lesson), [catalog, lesson]);
  const modelMembers = useMemo(() => [...new Set(modelIds.flatMap(id => catalog.members(id)))], [catalog, modelIds]);
  const heading = useRef<HTMLHeadingElement>(null);
  const reader = useRef<HTMLDivElement>(null);
  const focusFrame = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const outlineId = useId();
  const [outlineOpen, setOutlineOpen] = useLessonPanel("readerOutline", false);
  const modelId = useId();
  const [modelCollapsed, setModelCollapsed] = useState(false);
  const [compact, setCompact] = useState(false);
  const [progress, updateProgress, progressUnsaved] = useLessonProgress(lesson.id, preview, initialStepId);
  const { host, orientation, showAxes, fps, session, state, runtime } = useLessonViewer(catalog, graphics, usesModel ? modelIds : "", undefined,
    focusFrame, undefined, false, false, true);
  const [failed, setFailed] = useState(false);
  const issues = useMemo(() => lessonPreviewIssues(lesson, modelMembers, id => catalog.members(id)), [catalog, lesson, modelMembers]);
  const stepQuestions = (item: LessonStep) => item.questionRef || lessonMode(item) === "content" ? [] : item.questions ?? [];
  const awaitingAnswers = (item: LessonStep) => stepQuestions(item).some(question => progress.answers[`${item.id}/${question.id}`] !== question.answerId);
  const boundary = preview ? -1 : lesson.steps.findIndex(item => issues.has(item.id) || !progress.read.includes(item.id) || awaitingAnswers(item));
  const complete = progress.position === null && boundary === -1 && lesson.steps.length > 0;
  const savedIndex = lesson.steps.findIndex(item => item.id === progress.position);
  const resumeIndex = savedIndex < 0 && progress.position !== undefined && boundary >= 0 ? boundary : Math.max(0, savedIndex);
  const index = complete ? lesson.steps.length - 1 : boundary < 0 ? resumeIndex : Math.min(resumeIndex, boundary);
  const step: LessonStep = lesson.steps[index] ?? { id: "preview-empty", kind: "text", title: { vi: "", en: "" }, instruction: { vi: "", en: "" } };
  const issue = issues.get(step.id);
  const read = !preview && progress.read.includes(step.id);
  const reading = !preview && !complete && lesson.steps.length > 0 && !issue && !read;
  const readingActive = reading && studyVisible;
  const readingRestart = useReadingTimer(step.id, readingActive, id => {
    if (id !== step.id || !readingActive) return;
    updateProgress(current => ({ ...current, position: id, read: [...new Set([...current.read, id])] }));
  });
  const nextDescription = reading ? t("lessons.readingRequired")
    : !preview && !issue && awaitingAnswers(step) ? t("lessons.answersRequired") : undefined;
  const scene = useMemo(() => lessonSceneStep(lesson, complete ? 0 : index), [complete, index, lesson]);
  const showStepModel = usesModel && !!scene;
  const modelVisible = showStepModel && (!compact || !modelCollapsed);
  const sceneIds = useMemo(() => scene ? scene.visibleIds ?? catalog.members(scene.targetId) : [], [catalog, scene]);
  const sceneUsable = useMemo(() => {
    if (!scene) return false;
    try {
      validateLessonTargets({ ...lesson, steps: [{ ...scene, kind: "observe" }] }, modelMembers, id => catalog.members(id));
      return true;
    } catch { return false; }
  }, [catalog, lesson, scene, modelMembers]);
  const mode = step.questionRef ? "content" : lessonMode(step);
  const questions = stepQuestions(step);
  const instruction = lessonHtml(step.instruction, language, images.urls);
  const ready = !state.building && !state.error && !failed;
  const modelMissing = modelIds.some(id => !catalog.roots.some(root => root.id === id));

  useEffect(() => {
    const element = body.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setCompact(entry.contentRect.width <= 856);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const animation = requestAnimationFrame(() => runtime.current?.resize());
    return () => cancelAnimationFrame(animation);
  }, [outlineOpen, modelVisible, runtime, session]);

  useEffect(() => {
    if (!ready) return;
    if (!modelVisible || !sceneUsable) { session.changeVisibility(state.structureIds, false); return; }
    const animation = requestAnimationFrame(() => {
      if (!session.applyScene(sceneIds, scene?.view)) setFailed(true);
    });
    return () => cancelAnimationFrame(animation);
  }, [ready, modelVisible, scene, sceneUsable, session, sceneIds, index, complete, state.structureIds]);

  useEffect(() => {
    if (reader.current) reader.current.scrollTop = 0;
    heading.current?.focus({ preventScroll: true });
  }, [index, complete]);

  function stepLocked(next: number) {
    return boundary >= 0 && next > boundary;
  }

  function move(next: number) {
    if (stepLocked(next)) return;
    updateProgress(current => ({ ...current, position: lesson.steps[next]?.id }));
  }

  return <WorkspaceLayout className="lesson-player">
    <div className="lesson-model-canvas model-canvas" ref={host} inert={!modelVisible}
      aria-busy={!modelMissing && state.building && !state.error && !failed} />
    <WorkspaceMenu className="lesson-player-header" layout="inline" navigation={<>
        <SidebarToggle controls={outlineId} expanded={outlineOpen} name={t("lessons.outline")} onToggle={() => setOutlineOpen(!outlineOpen)} />
        <button className="controls-info lesson-exit" onClick={() => onBack()} aria-label={t("lessons.exit")} title={t("lessons.exit")}>
          <LineIcon name="arrow-small-left" size={18} />
          {t("lessons.exit")}
        </button>
      </>} title={<div className="lesson-player-heading">
        <h1>{lessonText(lesson.title, language) || t("lessons.untitled")}</h1>
        <span>{lesson.author?.trim() && `${t("lessons.author")}: ${lesson.author} · `}{preview && `${t("lessons.draftPreview")} · `}{lesson.steps.length ? t(complete ? "lessons.completed" : "lessons.step", { current: index + 1, total: lesson.steps.length }) : t("lessons.addContent")}</span>
        <LessonTimestamps lesson={lesson} />
      </div>} actions={<>
      {showStepModel && <button className="controls-info lesson-player-model-toggle" aria-controls={modelId} aria-expanded={!modelCollapsed}
        aria-label={t(modelCollapsed ? "lessons.showModel" : "lessons.hideModel")} title={t(modelCollapsed ? "lessons.showModel" : "lessons.hideModel")}
        onClick={() => setModelCollapsed(value => !value)}><LineIcon name="sidebar" size={18} /></button>}
      {onEdit && <button className="lesson-button lesson-primary" onClick={onEdit} aria-label={t("lessons.backEditor")}>
        <span className="lesson-action-full">{t("lessons.edit")}</span><span className="lesson-action-short">{t("lessons.editShort")}</span>
      </button>}
      </>} />
    <div className="lesson-player-body" ref={body} data-outline={outlineOpen}>
      <nav id={outlineId} className="lesson-reader-outline workspace-panel-surface" hidden={!outlineOpen} inert={!outlineOpen} aria-hidden={!outlineOpen} aria-label={t("lessons.outline")}>
        <div className="catalog-heading"><h2>{t("lessons.outline")}</h2></div>
        <div className="catalog-tree">
          <ol className="lesson-outline-list">
            {lesson.steps.map((item, i) => {
              const name = lessonText(item.title, language) || t("lessons.untitledSection");
              const itemRead = progress.read.includes(item.id);
              return <li key={item.id} className="lesson-outline-item">
                <button className="lesson-outline-row" aria-current={!complete && i === index ? "true" : undefined}
                  aria-description={t(itemRead ? "lessons.sectionRead" : "lessons.sectionUnread")}
                  disabled={stepLocked(i)} onClick={() => move(i)}>
                  <span className="lesson-outline-status" data-read={itemRead || undefined} aria-hidden="true" />
                  <strong className="lesson-outline-label">{name}</strong>
                </button>
              </li>;
            })}
          </ol>
        </div>
      </nav>
      <div className="lesson-workspace" data-model={modelVisible} onScroll={() => runtime.current?.resize()}>
      <section className="lesson-model" id={modelId} hidden={!modelVisible} inert={!modelVisible} aria-hidden={!modelVisible} aria-label={t("viewer.section.label")}>
        <div className="model-focus-frame" ref={focusFrame}>
          <div className="model-orientation">
            <div hidden={!showAxes}>
              <OrientationAxes ref={orientation} disabled={!ready || !modelVisible || !showAxes} onControl={session.control} />
            </div>
            {graphics.showFps && <span className="model-fps" aria-label={t("graphics.fps.current", { count: fps || "—" })}>{fps || "—"} FPS</span>}
          </div>
        </div>
        <div className="model-hud lesson-player-hud">
          {modelMissing ? <p className="model-status" role="status">{t("lessons.validation.target", { step: index + 1 })}</p>
            : failed ? <p className="model-status model-error" role="alert">{t("lessons.targetError")}</p>
            : <ViewerStatusNotice state={state} totalSystems={modelIds.length} />}
          {state.building && !state.error && !modelMissing && <progress className="model-progress" aria-label={t("viewer.loading.systems")}
            value={state.loadedSystems} max={modelIds.length} />}
          {!state.building && !state.error && !sceneUsable && <p className="model-status" role="status">{t("lessons.targetError")}</p>}
          <div className="lesson-model-tools">
            <button className="lesson-button lesson-player-reset" disabled={!ready || !sceneUsable} onClick={() => {
              if (!session.applyScene(sceneIds, scene?.view)) return;
            }}>{t("lessons.resetStudyScene")}</button>
            <a className="lesson-model-credit" href="/models/z-anatomy/ATTRIBUTION.md" target="_blank" rel="noreferrer"
              aria-label={t("credit.link")}>Z-Anatomy</a>
          </div>
        </div>
      </section>
      <section className="lesson-step workspace-panel-surface" aria-labelledby="lesson-step-title">
        {lesson.steps.length > 0 && <div className="lesson-editor-stepbar lesson-player-stepbar">
          {!complete && <button className="lesson-button lesson-step-previous" disabled={index === 0}
            onClick={() => move(index - 1)}>{t("lessons.previous")}</button>}
          <span>{t("lessons.step", { current: index + 1, total: lesson.steps.length })}</span>
          <div className="lesson-editor-stepbar-actions">
            {complete
              ? <button className="lesson-button" onClick={() => move(0)}>{t("lessons.review")}</button>
              : <button key={readingRestart} className="lesson-button lesson-primary" disabled={stepLocked(index + 1)}
                data-reading={readingActive || undefined} data-read={read || undefined}
                style={readingActive ? { animationDuration: `${READING_DURATION_MS}ms` } : undefined}
                title={nextDescription} aria-description={nextDescription} onClick={() => {
                if (index + 1 < lesson.steps.length) move(index + 1);
                else updateProgress(current => ({ ...current, position: null }));
              }}>{t(index + 1 < lesson.steps.length ? "lessons.next" : "lessons.finish")}</button>}
          </div>
        </div>}
        {progressUnsaved && <p className="model-status" role="status">{t("lessons.progressUnsaved")}</p>}
        <div className="information-content lesson-reader-body" ref={reader}>
        {complete ? <>
          <h2 id="lesson-step-title" ref={heading} tabIndex={-1}>{t("lessons.completed")}</h2>
        </> : <>
        <h2 id="lesson-step-title" ref={heading} tabIndex={-1}>{lessonText(step.title, language) || t(lesson.steps.length ? "lessons.untitledSection" : "lessons.addContent")}</h2>
        {step.sceneRef && <p className="model-status" role="status">{t("lessons.sceneFileUnavailable")}</p>}
        {step.questionRef && <p className="model-status" role="status">{t("lessons.questionFileUnavailable")}</p>}
        {issue && <p className="model-status lesson-preview-issue" role="status">{t(`lessons.validation.${issue.reason}`, { step: issue.step })}</p>}
        {mode !== "questions" && (lessonPlainText(step.instruction, language) || instruction.includes("<img ")
          ? <div className="lesson-instructions lesson-rich-content" dangerouslySetInnerHTML={{ __html: instruction }} />
          : !step.questionRef && <p className="lesson-instructions">{t("lessons.previewNoContent")}</p>)}
        {!lesson.steps.length && <button className="lesson-button lesson-primary" onClick={() => (onEdit ?? onBack)()}>{t("lessons.continueEditing")}</button>}
        </>}
        <div className="lesson-reader-questions" hidden={complete || !questions.length}>
          <LessonQuestions stepId={step.id} questions={questions} disabled={!preview && !!issue} correctAnswers={progress.answers}
            onCorrect={(key, choice) => updateProgress(current => ({ ...current, position: step.id, answers: { ...current.answers, [key]: choice } }))} />
        </div>
        </div>
      </section>
    </div>
    </div>
  </WorkspaceLayout>;
}
