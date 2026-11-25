import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Catalog } from "../../catalog/types";
import { useLanguage } from "../../i18n";
import type { Language } from "../../i18n";
import { LineIcon } from "../../icons";
import type { Lesson, LessonStep, LessonText } from "../shared/contract";
import { emptyLessonText, lessonMode, lessonPreviewIssues, lessonText, validateLessonTargets } from "../shared/contract";
import { findLessonSection, lessonSectionAt, lessonSectionTitle, resolveLessonSectionScene } from "../shared/sections";
import type { LessonReaderMode } from "../shared/sections";
import { useLessonViewer } from "../shared/viewer";
import { LessonModelCanvas, LessonModelSurface } from "../shared/model-surface";
import { LessonQuestions } from "./questions";
import { lessonHtml, plainLessonHtml } from "../shared/rich-text";
import { useLessonImages } from "../shared/image-context";
import { lessonModels } from "../shared/targets";
import { LessonContentPanel, LessonHeader, LessonOutlinePanel, LessonSectionList, LessonStepNavigation, LessonWorkspaceLayout } from "../shared/workspace";
import { useLessonProgress } from "./progress";
import { READING_DURATION_MS, useReadingTimer } from "./reading-timer";

export function LessonPlayer({ lesson, catalog, mode, onBack, onEdit, previewLocale, initialStepId, studyVisible = true }: {
  lesson: Lesson;
  catalog: Catalog;
  mode: LessonReaderMode;
  onBack: () => void;
  onEdit?: () => void;
  previewLocale?: Language;
  initialStepId?: string;
  studyVisible?: boolean;
}) {
  const { language, t } = useLanguage();
  const preview = mode === "preview";
  const contentLanguage = previewLocale ?? language;
  const readText = (value: LessonText) => lessonText(value, contentLanguage, previewLocale === undefined);
  const images = useLessonImages();
  const usesModel = lesson.steps.some(step => step.kind !== "text") && lesson.steps.some(step => step.showModel !== false);
  const modelIds = useMemo(() => lessonModels(catalog, lesson), [catalog, lesson]);
  const modelMembers = useMemo(() => [...new Set(modelIds.flatMap(id => catalog.members(id)))], [catalog, modelIds]);
  const heading = useRef<HTMLHeadingElement>(null);
  const reader = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const modelId = useId();
  const [modelCollapsed, setModelCollapsed] = useState(false);
  const [compact, setCompact] = useState(false);
  const [progress, updateProgress, progressUnsaved] = useLessonProgress(lesson.id, mode, initialStepId);
  const issues = useMemo(() => lessonPreviewIssues(lesson, modelMembers, id => catalog.members(id)), [catalog, lesson, modelMembers]);
  const stepQuestions = (item: LessonStep) => item.questionRef || lessonMode(item) === "content" ? [] : item.questions ?? [];
  const awaitingAnswers = (item: LessonStep) => stepQuestions(item).some(question => progress.answers[`${item.id}/${question.id}`] !== question.answerId);
  const boundary = preview ? -1 : lesson.steps.findIndex(item => issues.has(item.id) || !progress.read.includes(item.id) || awaitingAnswers(item));
  const complete = progress.position === null && boundary === -1 && lesson.steps.length > 0;
  const savedIndex = findLessonSection(lesson.steps, progress.position);
  const resumeIndex = savedIndex < 0 && progress.position !== undefined && boundary >= 0 ? boundary : Math.max(0, savedIndex);
  const index = complete ? lesson.steps.length - 1 : boundary < 0 ? resumeIndex : Math.min(resumeIndex, boundary);
  const section = lessonSectionAt(lesson.steps, index);
  const step: LessonStep = section.step ?? { id: "preview-empty", kind: "text", title: emptyLessonText, instruction: emptyLessonText };
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
  const scene = useMemo(() => resolveLessonSectionScene(lesson, complete ? 0 : index, mode), [complete, index, lesson, mode]);
  const showStepModel = usesModel && !!scene;
  const modelVisible = showStepModel && (!compact || !modelCollapsed);
  const sceneUsable = useMemo(() => {
    if (!scene) return false;
    try {
      validateLessonTargets({ ...lesson, steps: [{ ...scene, kind: "observe" }] }, modelMembers, id => catalog.members(id));
      return true;
    } catch { return false; }
  }, [catalog, lesson, scene, modelMembers]);
  const sectionMode = step.questionRef ? "content" : lessonMode(step);
  const questions = stepQuestions(step);
  const instruction = lessonHtml(step.instruction, contentLanguage, images.urls, previewLocale === undefined);
  const viewer = useLessonViewer({ catalog, modelIds: usesModel ? modelIds : [], scene,
    sectionId: complete ? null : step.id, visible: modelVisible, sceneUsable });
  const { state, ready, sceneFailed, resize, applyScene } = viewer;
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

  const hasStep = lesson.steps.length > 0 && !complete;
  return <LessonWorkspaceLayout mode={mode} modelVisible={modelVisible} hasStep={hasStep} bodyRef={body} onScroll={resize} modelRegionId={modelId}
    background={<LessonModelCanvas viewer={viewer} className="lesson-model-canvas" inactive={!modelVisible}
      busy={!modelMissing && state.building && !state.error && !sceneFailed} />}
    header={<LessonHeader title={readText(lesson.title) || t("lessons.untitled")} lesson={lesson}
      subtitle={<>
        {lesson.author?.trim() && `${t("lessons.author")}: ${lesson.author} · `}
        {preview && `${t("lessons.draftPreview")} · `}
        {lesson.steps.length ? t(complete ? "lessons.completed" : "lessons.step", section.position) : t("lessons.addContent")}
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
      <LessonSectionList steps={lesson.steps} selected={complete ? undefined : section.step?.id} language={contentLanguage}
        fallback={previewLocale === undefined} onSelect={(_, i) => move(i)} configureRow={(item, i) => {
          const itemRead = progress.read.includes(item.id);
          return { button: { "aria-description": t(itemRead ? "lessons.sectionRead" : "lessons.sectionUnread"), disabled: stepLocked(i) },
            indicator: <span className="lesson-outline-status" data-read={itemRead || undefined} aria-hidden="true" /> };
        }} />
    </LessonOutlinePanel>}
    scene={<LessonModelSurface viewer={viewer} disabled={!ready || !modelVisible} hud={{
      className: "lesson-player-hud", totalSystems: modelIds.length, showProgress: !modelMissing,
      status: modelMissing ? <p className="model-status" role="status">{t("lessons.validation.target", { step: index + 1 })}</p>
        : sceneFailed ? <p className="model-status model-error" role="alert">{t("lessons.targetError")}</p>
        : undefined,
      afterStatus: !state.building && !state.error && !sceneUsable && <p className="model-status" role="status">{t("lessons.targetError")}</p>,
      actions: <button className="lesson-button lesson-player-reset" disabled={!ready || !sceneUsable}
        onClick={applyScene}>{t("lessons.resetStudyScene")}</button>,
    }} />}
    document={<LessonContentPanel aria-labelledby="lesson-step-title" data-preview={preview || undefined} expandable={hasStep}>
        {lesson.steps.length > 0 && <LessonStepNavigation position={section.position}
          onPrevious={complete ? undefined : () => move(index - 1)} previousDisabled={!section.previous}
          actions={complete
              ? <button className="lesson-button" onClick={() => move(0)}>{t("lessons.review")}</button>
              : <button key={readingRestart} className="lesson-button lesson-primary" disabled={stepLocked(index + 1)}
                data-reading={readingActive || undefined} data-read={read || undefined}
                style={readingActive ? { animationDuration: `${READING_DURATION_MS}ms` } : undefined}
                title={nextDescription} aria-description={nextDescription} onClick={() => {
                if (section.next) move(index + 1);
                else updateProgress(current => ({ ...current, position: null }));
              }}>{t(section.next ? "lessons.next" : "lessons.finish")}</button>}
          />}
        {progressUnsaved && <p className="model-status" role="status">{t("lessons.progressUnsaved")}</p>}
        <div className="information-content lesson-reader-body" ref={reader}>
        {complete ? <>
          <h2 id="lesson-step-title" ref={heading} tabIndex={-1}>{t("lessons.completed")}</h2>
        </> : <>
        <h2 id="lesson-step-title" className={hasStep ? "lesson-step-title" : undefined} ref={heading} tabIndex={-1}
          lang={previewLocale && step.title[previewLocale].trim() ? previewLocale : undefined}>{lessonSectionTitle(step, contentLanguage,
            t(lesson.steps.length ? "lessons.untitledSection" : "lessons.addContent"), previewLocale === undefined)}</h2>
        {step.sceneRef && <p className="model-status" role="status">{t("lessons.sceneFileUnavailable")}</p>}
        {step.questionRef && <p className="model-status" role="status">{t("lessons.questionFileUnavailable")}</p>}
        {issue && <p className="model-status lesson-preview-issue" role="status">{t(`lessons.validation.${issue.reason}`, { step: issue.step })}</p>}
        {sectionMode !== "questions" && (plainLessonHtml(instruction) || /<(?:img|iframe|video|audio)\b/i.test(instruction)
          ? <div className="lesson-instructions lesson-rich-content lesson-content-sheet" lang={previewLocale} dangerouslySetInnerHTML={{ __html: instruction }} />
          : !step.questionRef && <p className="lesson-instructions lesson-rich-content lesson-content-sheet">{t("lessons.previewNoContent")}</p>)}
        {!lesson.steps.length && <button className="lesson-button lesson-primary" onClick={() => (onEdit ?? onBack)()}>{t("lessons.continueEditing")}</button>}
        </>}
        <div className="lesson-reader-questions" hidden={complete || !questions.length}>
          <LessonQuestions stepId={step.id} questions={questions} previewLocale={previewLocale} disabled={!preview && !!issue} correctAnswers={progress.answers}
            onCorrect={(key, choice) => updateProgress(current => ({ ...current, position: step.id, answers: { ...current.answers, [key]: choice } }))} />
        </div>
        </div>
      </LessonContentPanel>}
  />;
}
