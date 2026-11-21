import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Catalog } from "../../anatomy/catalog/types";
import { useLanguage } from "../../i18n";
import { LineIcon } from "../../icons";
import type { Lesson, LessonStep } from "../shared/contract";
import { lessonMode, lessonPreviewIssues, lessonSceneStep, lessonText, validateLessonTargets } from "../shared/contract";
import { useLessonViewer } from "../shared/viewer";
import { LessonModelHud } from "../shared/model-hud";
import { LessonModelFrame } from "../shared/model-frame";
import { LessonQuestions } from "./questions";
import { lessonHtml, lessonPlainText } from "../shared/rich-text";
import { useLessonImages } from "../shared/image-context";
import { lessonModels } from "../shared/targets";
import { useGraphicsSettings } from "../../pages/use-graphics-settings";
import { LessonContentPanel, LessonHeader, LessonOutlinePanel, LessonOutlineRow, LessonStepNavigation, LessonWorkspace } from "../shared/workspace";
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
  }, [modelVisible, runtime, session]);

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

  return <LessonWorkspace modelVisible={modelVisible} bodyRef={body} onScroll={() => runtime.current?.resize()}
    background={<div className="lesson-model-canvas model-canvas" ref={host} inert={!modelVisible}
      aria-busy={!modelMissing && state.building && !state.error && !failed} />}
    header={<LessonHeader title={lessonText(lesson.title, language) || t("lessons.untitled")} lesson={lesson}
      subtitle={<>
        {lesson.author?.trim() && `${t("lessons.author")}: ${lesson.author} · `}
        {preview && `${t("lessons.draftPreview")} · `}
        {lesson.steps.length ? t(complete ? "lessons.completed" : "lessons.step", { current: index + 1, total: lesson.steps.length }) : t("lessons.addContent")}
      </>}
      onBack={() => onBack()}
      actions={<>
        {showStepModel && <button className="controls-info lesson-player-model-toggle" aria-controls={modelId} aria-expanded={!modelCollapsed}
          aria-label={t(modelCollapsed ? "lessons.showModel" : "lessons.hideModel")} title={t(modelCollapsed ? "lessons.showModel" : "lessons.hideModel")}
          onClick={() => setModelCollapsed(value => !value)}><LineIcon name="sidebar" size={18} /></button>}
        {onEdit && <button className="lesson-button lesson-primary" onClick={onEdit} aria-label={t("lessons.backEditor")}>
          <span className="lesson-action-full">{t("lessons.edit")}</span><span className="lesson-action-short">{t("lessons.editShort")}</span>
        </button>}
      </>} />}
    outline={<LessonOutlinePanel>
      <ol className="lesson-outline-list">
        {lesson.steps.map((item, i) => {
          const name = lessonText(item.title, language) || t("lessons.untitledSection");
          const itemRead = progress.read.includes(item.id);
          return <li key={item.id} className="lesson-outline-item">
            <LessonOutlineRow label={name} aria-current={!complete && i === index ? "true" : undefined}
              aria-description={t(itemRead ? "lessons.sectionRead" : "lessons.sectionUnread")}
              disabled={stepLocked(i)} onClick={() => move(i)}
              indicator={<span className="lesson-outline-status" data-read={itemRead || undefined} aria-hidden="true" />} />
          </li>;
        })}
      </ol>
    </LessonOutlinePanel>}>
      <section className="lesson-model lesson-model-surface" id={modelId} hidden={!modelVisible} inert={!modelVisible}
        aria-hidden={!modelVisible} aria-label={t("viewer.section.label")}>
        <LessonModelFrame ref={focusFrame} orientation={orientation} showAxes={showAxes} disabled={!ready || !modelVisible}
          onControl={session.control} fps={graphics.showFps ? fps : undefined} />
        <LessonModelHud className="lesson-player-hud" state={state} totalSystems={modelIds.length} showProgress={!modelMissing}
          status={modelMissing ? <p className="model-status" role="status">{t("lessons.validation.target", { step: index + 1 })}</p>
            : failed ? <p className="model-status model-error" role="alert">{t("lessons.targetError")}</p>
            : undefined}
          afterStatus={!state.building && !state.error && !sceneUsable && <p className="model-status" role="status">{t("lessons.targetError")}</p>}
          actions={<button className="lesson-button lesson-player-reset" disabled={!ready || !sceneUsable}
            onClick={() => session.applyScene(sceneIds, scene?.view)}>{t("lessons.resetStudyScene")}</button>} />
      </section>
      <LessonContentPanel aria-labelledby="lesson-step-title" data-preview={preview || undefined}>
        {lesson.steps.length > 0 && <LessonStepNavigation position={{ current: index + 1, total: lesson.steps.length }}
          onPrevious={complete ? undefined : () => move(index - 1)} previousDisabled={index === 0}
          actions={complete
              ? <button className="lesson-button" onClick={() => move(0)}>{t("lessons.review")}</button>
              : <button key={readingRestart} className="lesson-button lesson-primary" disabled={stepLocked(index + 1)}
                data-reading={readingActive || undefined} data-read={read || undefined}
                style={readingActive ? { animationDuration: `${READING_DURATION_MS}ms` } : undefined}
                title={nextDescription} aria-description={nextDescription} onClick={() => {
                if (index + 1 < lesson.steps.length) move(index + 1);
                else updateProgress(current => ({ ...current, position: null }));
              }}>{t(index + 1 < lesson.steps.length ? "lessons.next" : "lessons.finish")}</button>}
          />}
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
      </LessonContentPanel>
  </LessonWorkspace>;
}
