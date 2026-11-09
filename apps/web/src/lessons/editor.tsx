import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { Catalog } from "../anatomy/catalog/types";
import { useLanguage } from "../i18n";
import type { Language } from "../i18n";
import { LineIcon } from "../icons";
import { LessonValidationError, lessonMode, lessonQuestions, lessonSceneStep, lessonText, readLesson, updateLessonQuestions } from "./contract";
import type { Lesson, LessonStep, LessonText } from "./contract";
import { EditorScene } from "./editor-scene";
import type { EditorSceneHandle } from "./editor-scene";
import { LessonModelSetup } from "./model-setup";
import { LessonDetails } from "./details";
import { LessonStepOptions } from "./step-options";
import { LessonQuestionEditor } from "./question-editor";
import { exportLesson, newLessonId } from "./source";
import { lessonModels, lessonTargets } from "./targets";
import type { SceneView } from "../anatomy/viewer/contracts";
import { useLessonPanel } from "./panels";
import { LessonOutline } from "./outline";

const RichEditor = lazy(() => import("./rich-editor"));

export const emptyText = { vi: "", en: "" };

export function LessonEditor({ catalog, lesson, saved, selected, saveFailed, onSelect, onChange, onPreview, onBack }: {
  catalog: Catalog;
  lesson: Lesson;
  saved: Lesson;
  selected?: string;
  saveFailed: boolean;
  onSelect: (id?: string) => void;
  onChange: (lesson: Lesson) => boolean;
  onPreview: () => void;
  onBack: () => void;
}) {
  const { language, t } = useLanguage();
  const [locale, setLocale] = useState<Language>();
  const [error, setError] = useState("");
  const [savedStep, setSavedStep] = useState(false);
  const [savedView, setSavedView] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [outlineOpen, setOutlineOpen] = useLessonPanel("editorOutline", window.matchMedia("(min-width: 901px)").matches);
  const [revealPart, setRevealPart] = useState<{ id: string; target?: boolean }>();
  const [orderStatus, setOrderStatus] = useState("");
  const [sceneFrame, setSceneFrame] = useState<HTMLDivElement | null>(null);
  const [sceneControls, setSceneControls] = useState<HTMLDivElement | null>(null);
  const editorLanguage = locale ?? language;
  const index = lesson.steps.findIndex(step => step.id === selected);
  const active = lesson.steps[index];
  const inherited = lessonSceneStep(lesson, Math.max(0, index));
  const primaryModelId = lesson.modelIds?.[0] || lesson.modelId;
  const defaultScene = useMemo(() => lesson.scene ?? (primaryModelId ? { targetId: primaryModelId } : undefined), [lesson.scene, primaryModelId]);
  const scene = active && active.kind !== "text" ? active : inherited ?? defaultScene;
  const visibleIds = useMemo(() => scene?.visibleIds ?? catalog.members(scene?.targetId ?? ""), [catalog, scene?.visibleIds, scene?.targetId]);
  const modelIds = lessonModels(catalog, lesson);
  const modelKey = modelIds.join(",");
  const targets = useMemo(() => modelKey.split(",").flatMap(id => lessonTargets(catalog, id)), [catalog, modelKey]);
  const heading = useRef<HTMLHeadingElement>(null);
  const titleField = useRef<HTMLInputElement>(null);
  const focusAdded = useRef<string | null>(null);
  const sceneHandle = useRef<EditorSceneHandle>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => {
    if (focusAdded.current && focusAdded.current === selected) {
      focusAdded.current = null;
      titleField.current?.focus();
    }
  }, [selected]);

  // So sánh step hiện tại với step đã lưu để xác định trạng thái "Đã lưu"
  useEffect(() => {
    if (!active) {
      // So sánh lesson details (title, summary, scene)
      const savedDetails = saved.steps.length === 0
        ? saved
        : saved;
      const detailsMatch = JSON.stringify({ title: lesson.title, summary: lesson.summary, scene: lesson.scene, modelId: lesson.modelId, modelIds: lesson.modelIds })
        === JSON.stringify({ title: savedDetails.title, summary: savedDetails.summary, scene: savedDetails.scene, modelId: savedDetails.modelId, modelIds: savedDetails.modelIds });
      setSavedStep(detailsMatch);
    } else {
      const savedStep = saved.steps.find(s => s.id === active.id);
      if (savedStep) {
        setSavedStep(JSON.stringify(active) === JSON.stringify(savedStep));
      } else {
        setSavedStep(false);
      }
    }
  }, [selected, active, lesson.title, lesson.summary, lesson.scene, saved]);

  // So sánh scene hiện tại với scene đã lưu
  useEffect(() => {
    if (!scene) {
      setSavedView(false);
      return;
    }
    if (!active) {
      const savedScene = saved.scene;
      if (savedScene) {
        setSavedView(JSON.stringify({ visibleIds: scene.visibleIds, view: scene.view })
          === JSON.stringify({ visibleIds: savedScene.visibleIds, view: savedScene.view }));
      } else {
        setSavedView(false);
      }
    } else {
      const savedStep = saved.steps.find(s => s.id === active.id);
      const savedSceneStep = savedStep && savedStep.kind !== "text" ? savedStep : saved.scene;
      if (savedSceneStep) {
        setSavedView(JSON.stringify({ visibleIds: scene.visibleIds, view: scene.view })
          === JSON.stringify({ visibleIds: savedSceneStep.visibleIds, view: savedSceneStep.view }));
      } else {
        setSavedView(false);
      }
    }
  }, [selected, scene, active, saved]);

  function update(patch: Partial<Lesson>) {
    setError("");
    setSavedStep(false);
    return onChange({ ...lesson, ...patch });
  }

  function updateActive(value: LessonStep) {
    setSavedStep(false);
    return update({ steps: lesson.steps.map(step => step.id === value.id ? value : step) });
  }

  function updateScene(visibleIds: string[], view: SceneView | undefined = scene?.view) {
    const patch = { targetId: sceneTargetId, visibleIds, view };
    if (!active) return update({ scene: patch });
    setSavedView(false);
    return updateActive(active.kind === "identify_structure" ? { ...active, ...patch }
      : { ...active, kind: "observe", ...patch });
  }

  function changeModels(nextModelIds: string[]) {
    const currentModelIds = lesson.modelIds?.length ? lesson.modelIds : (lesson.modelId ? [lesson.modelId] : []);
    const prevKey = currentModelIds.slice().sort().join(",");
    const nextKey = nextModelIds.slice().sort().join(",");
    if (prevKey === nextKey) return;

    const hadScenes = !!(lesson.scene?.view || lesson.scene?.visibleIds?.length
      || lesson.steps.some(step => step.kind !== "text" && (step.targetId || step.visibleIds)));
    const removedRoots = currentModelIds.filter(id => !nextModelIds.includes(id));

    if (removedRoots.length > 0 && hadScenes && !window.confirm(t("lessons.confirmSceneReset"))) return;

    const primaryId = nextModelIds[0] ?? "";
    const removedMembers = new Set(removedRoots.flatMap(id => catalog.members(id)));
    const cleanVisibleIds = (ids?: string[]) => ids ? ids.filter(id => !removedMembers.has(id)) : undefined;

    update({
      modelId: primaryId,
      modelIds: nextModelIds,
      scene: nextModelIds.length === 0 ? undefined : (lesson.scene ? {
        ...lesson.scene,
        targetId: removedRoots.includes(lesson.scene.targetId) ? primaryId : lesson.scene.targetId,
        visibleIds: cleanVisibleIds(lesson.scene.visibleIds),
      } : undefined),
      steps: lesson.steps.map(step => {
        if (nextModelIds.length === 0 && step.kind !== "identify_structure") {
          return {
            id: step.id, title: step.title, instruction: step.instruction, showModel: step.showModel,
            mode: step.mode, questions: step.questions, kind: "text",
          };
        }
        if (step.kind === "text") return step;
        const targetId = removedRoots.includes(step.targetId) ? primaryId : step.targetId;
        const visibleIds = cleanVisibleIds(step.visibleIds);
        const patch = { targetId, visibleIds, view: step.view };
        return step.kind === "identify_structure"
          ? { ...step, ...patch, choiceIds: step.choiceIds.filter(id => !removedMembers.has(id)) }
          : { ...step, kind: "observe", ...patch };
      }),
    });
  }

  function changeModel(modelId: string) {
    if (!modelId) changeModels([]);
    else changeModels([modelId]);
  }

  function addStructures(ids: string[], partId?: string) {
    setRevealPart(partId ? { id: partId } : undefined);
    const rootsForIds = catalog.roots.filter(root => {
      const members = new Set(catalog.members(root.id));
      return ids.some(id => members.has(id));
    }).map(r => r.id);
    const currentModelIds = lesson.modelIds?.length ? lesson.modelIds : (lesson.modelId ? [lesson.modelId] : []);
    const newModelIds = [...new Set([...currentModelIds, ...rootsForIds])];
    const modelId = lesson.modelId || newModelIds[0];
    if (!modelId) { setError(t("lessons.targetError")); return; }
    const patch = { targetId: sceneTargetId || modelId, view: scene?.view,
      visibleIds: [...new Set([...(scene?.visibleIds ?? catalog.members(sceneTargetId)), ...ids])] };
    update({
      modelId,
      modelIds: newModelIds,
      steps: lesson.steps.map(step => {
        if (lesson.modelId && step.id !== active?.id) return step;
        return step.kind === "identify_structure" ? { ...step, ...patch } : { ...step, kind: "observe", ...patch };
      }),
    });
  }

  function select(id?: string) {
    setSavedStep(false);
    setSavedView(false);
    setError("");
    setRevealPart(undefined);
    onSelect(id);
  }

  function save() {
    if (showModel && hasModel) {
      const snapshot = sceneHandle.current?.capture();
      if (!snapshot) { setError(t("lessons.sceneSaveUnavailable")); return; }
      if (!updateScene(snapshot.visibleIds, snapshot.view)) return;
    } else if (!update({})) return;
    setSavedStep(true);
  }

  function add() {
    const base = { id: newLessonId(), title: emptyText, instruction: emptyText, showModel: active?.showModel };
    const step: LessonStep = hasModel
      ? { ...base, kind: "observe", targetId: scene?.targetId ?? primaryModelId, visibleIds: scene?.visibleIds, view: scene?.view }
      : { ...base, kind: "text" };
    const insertion = active ? index + 1 : lesson.steps.length;
    update({ steps: [...lesson.steps.slice(0, insertion), step, ...lesson.steps.slice(insertion)] });
    select(step.id);
    focusAdded.current = step.id;
  }

  function move(from: number, to: number) {
    if (from < 0 || from >= lesson.steps.length || to < 0 || to >= lesson.steps.length || from === to) return;
    const steps = [...lesson.steps];
    const step = steps.splice(from, 1)[0]!;
    steps.splice(to, 0, step);
    update({ steps });
    setOrderStatus(t("lessons.stepMoved", { name: lessonText(step.title, language) || t("lessons.untitledSection"), position: to + 1 }));
  }

  function remove() {
    if (!active || !window.confirm(t("lessons.confirmRemoveBlock"))) return;
    const steps = lesson.steps.filter(step => step.id !== active.id);
    update({ steps });
    select((steps[index] ?? steps[index - 1])?.id);
  }

  async function exportDraft() {
    setExporting(true);
    try {
      readLesson(lesson, true);
      setError("");
      await exportLesson(lesson, language);
    } catch (cause) {
      if (cause instanceof LessonValidationError) {
        select(cause.step ? lesson.steps[cause.step - 1]?.id : undefined);
        setError(t(`lessons.validation.${cause.reason}`, { step: cause.step }));
      } else setError(t("lessons.exportError"));
    } finally { setExporting(false); }
  }

  const title = active?.title ?? lesson.title;
  const body = active?.instruction ?? lesson.summary;
  const sceneTargetId = scene && targets.some(target => target.id === scene.targetId) ? scene.targetId : primaryModelId;
  const hasModel = modelIds.length > 0 && modelIds.some(id => catalog.roots.some(model => model.id === id));
  const showModel = !!active && active.showModel !== false;
  const renderScene = showModel && hasModel;

  return <div className="lesson-editor study-shell" data-outline={outlineOpen}>
    {renderScene && sceneFrame && sceneControls && <EditorScene modelIds={modelIds} targetId={sceneTargetId}
      visibleIds={scene?.visibleIds} view={scene?.view} sectionId={active?.id ?? lesson.id} sceneRef={sceneHandle}
      revealPart={revealPart} saved={savedView}
      onSaveView={(view, ids) => { updateScene(ids, view); setSavedView(true); }}
      onChangeScene={ids => updateScene(ids)}
      frame={sceneFrame} controls={sceneControls} inactive={false} />}
    <header className="app-menu-bar lesson-author-bar">
      <div className="app-menu-history">
        <button className="controls-info" aria-label={t("lessons.library")} title={t("lessons.library")} onClick={onBack}>
          <LineIcon name="arrow-small-left" size={18} />
          {t("lessons.exit")}
        </button>
      </div>
      <div className="lesson-author-heading">
        <h1 className="app-menu-title" ref={heading} tabIndex={-1}>{lessonText(lesson.title, language) || t("lessons.editor")}</h1>
        {saveFailed ? <button className="lesson-save-retry" onClick={() => onChange(lesson)} title={t("lessons.saveError")}>{t("lessons.retry")}</button>
          : <span>{t(showModel && hasModel ? "lessons.contentSaved" : "lessons.saved")}</span>}
      </div>
      <div className="app-menu-actions lesson-author-actions">
        <button className="lesson-button" aria-label={t("lessons.export")} disabled={exporting} aria-busy={exporting} onClick={() => void exportDraft()}>
          <span className="lesson-action-full">{t("lessons.export")}</span><span className="lesson-action-short">{t("lessons.exportShort")}</span>
        </button>
        <button className="lesson-button lesson-primary" aria-label={t("lessons.preview")} onClick={onPreview}>
          <span className="lesson-action-full">{t("lessons.preview")}</span><span className="lesson-action-short">{t("lessons.previewShort")}</span>
        </button>
      </div>
    </header>
    <div className="lesson-author-workspace" data-outline={outlineOpen}>
    <nav className="workspace-panel-surface lesson-author-outline" id="lesson-author-outline" hidden={!outlineOpen}
      aria-label={t("lessons.outline")}>
      <div className="catalog-heading"><h2>{t("lessons.outline")}</h2></div>
      <div className="catalog-tree">
        <button className="lesson-outline-row" aria-current={!active ? "true" : undefined} onClick={() => select()}>
          <span className="lesson-block-icon" aria-hidden="true">≡</span>
          <span>{t("lessons.details")}</span>
        </button>
        <LessonOutline steps={lesson.steps} selected={selected} onSelect={select} onMove={move} />
      </div>
      <div className="lesson-author-tools">
        <button className="lesson-outline-row lesson-tool" onClick={add}>
          <span className="lesson-block-icon" aria-hidden="true">+</span>
          <span>{t("lessons.addStep")}</span>
        </button>
      </div>
    </nav>
    <p className="sr-only" role="status">{orderStatus}</p>

    <div className="lesson-author-center" data-model={showModel}>
      {(saveFailed || error) && <div className="lesson-author-alerts">
        {saveFailed && <p className="model-status model-error" role="alert">{t("lessons.saveError")}</p>}
        {error && <p className="model-status model-error" role="alert">{error}</p>}
      </div>}
      {showModel && <div className="lesson-scene-region lesson-model" onPointerDownCapture={() => setSavedView(false)}
        onWheelCapture={() => setSavedView(false)} onKeyDownCapture={() => setSavedView(false)}>
        <div className="lesson-scene-viewport" ref={setSceneFrame}>
        {!renderScene && <div className="lesson-scene-placeholder workspace-panel-surface">
          <span className="lesson-block-icon" aria-hidden="true">3D</span>
          <p>{t("lessons.scenePlaceholder")}</p>
        </div>}
        </div>
        <div className="lesson-editor-hud">
          <LessonModelSetup catalog={catalog} modelId={lesson.modelId} modelIds={modelIds} targetId={sceneTargetId}
            visibleIds={visibleIds} selectedPart={revealPart?.id} onSelectPart={(id, target) => setRevealPart({ id, target })}
            onModel={changeModel} onModels={changeModels} onChoose={addStructures}
            onChangeScene={ids => hasModel ? updateScene(ids) : addStructures(ids)} />
          {renderScene && <div className="lesson-scene-controls" ref={setSceneControls} />}
        </div>
      </div>}
      <section className="lesson-author-document workspace-panel-surface" id="lesson-author-writing"
        aria-label={t("lessons.writing")}>
        <div className="lesson-editor-stepbar">
          <span>{active ? t("lessons.step", { current: index + 1, total: lesson.steps.length }) : t("lessons.details")}</span>
          <button className="lesson-button lesson-primary" data-saved={savedStep} disabled={savedStep} onClick={save}>
            {savedStep ? t("lessons.savedShort") : t(active ? "lessons.saveStep" : "lessons.saveDetails")}
          </button>
          <button className="lesson-button" onClick={add}>{t("lessons.addStep")}</button>
        </div>
        <div className="information-content">
          <div className="lesson-document-meta">
            <span>{t(active ? "lessons.learningStep" : "lessons.details")}</span>
            <div className="lesson-languages" role="group" aria-label={t("lessons.writingLanguage")}>
              {(["vi", "en"] as const).map(value => <button key={value} type="button" aria-pressed={editorLanguage === value}
                aria-label={value === "vi" ? "Tiếng Việt" : "English"} onClick={() => setLocale(value)}>{value.toUpperCase()}</button>)}
            </div>
          </div>
          <label className={active ? "sr-only" : "lesson-details-label"} htmlFor="lesson-write-title">{t(active ? "lessons.stepTitle" : "lessons.title")} ({editorLanguage.toUpperCase()})</label>
          <input id="lesson-write-title" className="lesson-write-title" ref={titleField} value={title[editorLanguage]}
            placeholder={t(active ? "lessons.stepTitle" : "lessons.title")} lang={editorLanguage}
            onChange={event => {
              const value = { ...title, [editorLanguage]: event.target.value };
              if (active) updateActive({ ...active, title: value });
              else update({ title: value });
            }} />
          {active && <LessonStepOptions catalog={catalog} active={active} onChange={updateActive} />}
          {active && lessonMode(active) !== "questions" ? <Suspense fallback={<p role="status">{t("lessons.loadingEditor")}</p>}>
            <RichEditor key={`${active?.id ?? lesson.id}/${editorLanguage}`} value={body} language={editorLanguage}
              label={`${t(active ? "lessons.instruction" : "lessons.summary")} (${editorLanguage.toUpperCase()})`}
              onChange={(value: LessonText) => {
                if (active) updateActive({ ...active, instruction: value });
                else update({ summary: value });
              }} />
          </Suspense> : !active && <LessonDetails lesson={lesson} language={editorLanguage} onChange={update} />}
          {active && lessonMode(active) !== "content" && <LessonQuestionEditor
            questions={lessonQuestions(active, id => catalog.target(id)?.names)} locale={editorLanguage}
            onChange={questions => updateActive(updateLessonQuestions(active, lessonMode(active), questions))} />}
          {!active && !lesson.steps.length && <p className="lesson-document-hint">{t("lessons.firstBlock")}</p>}
          {active && <div className="lesson-step-management">
            <button className="lesson-button lesson-remove-block" onClick={remove}>{t("lessons.removeStep")}</button>
          </div>}
        </div>
      </section>
    </div>

    </div>
  </div>;
}
