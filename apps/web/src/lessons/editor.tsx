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

export function LessonEditor({ catalog, lesson, saved, selected, saveFailed, onSelect, onChange, onDraftChange, onPreview, onBack }: {
  catalog: Catalog;
  lesson: Lesson;
  saved: Lesson;
  selected?: string;
  saveFailed: boolean;
  onSelect: (id?: string) => void;
  onChange: (lesson: Lesson) => boolean;
  onDraftChange?: (lesson: Lesson) => void;
  onPreview: () => void;
  onBack: () => void;
}) {
  const { language, t } = useLanguage();
  const [draft, setDraft] = useState<Lesson>(lesson);
  const [locale, setLocale] = useState<Language>();
  const [error, setError] = useState("");
  const [saveNotice, setSaveNotice] = useState("");
  const [savedStep, setSavedStep] = useState(false);
  const [savedView, setSavedView] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [outlineOpen, setOutlineOpen] = useLessonPanel("editorOutline", window.matchMedia("(min-width: 901px)").matches);
  const [revealPart, setRevealPart] = useState<{ id: string; target?: boolean }>();
  const [orderStatus, setOrderStatus] = useState("");
  const [sceneFrame, setSceneFrame] = useState<HTMLDivElement | null>(null);
  const [sceneControls, setSceneControls] = useState<HTMLDivElement | null>(null);
  const editorLanguage = locale ?? language;
  useEffect(() => {
    if (draft.languages?.length === 1 && editorLanguage !== draft.languages[0]) {
      setLocale(draft.languages[0]);
    }
  }, [draft.languages, editorLanguage]);
  useEffect(() => { setDraft(lesson); }, [lesson]);
  const index = draft.steps.findIndex(step => step.id === selected);
  const active = draft.steps[index];
  const inherited = lessonSceneStep(draft, Math.max(0, index));
  const primaryModelId = draft.modelIds?.[0] || draft.modelId;
  const defaultScene = useMemo(() => draft.scene ?? (primaryModelId ? { targetId: primaryModelId } : undefined), [draft.scene, primaryModelId]);
  const scene = active && active.kind !== "text" ? active : inherited ?? defaultScene;
  const visibleIds = useMemo(() => scene?.visibleIds ?? catalog.members(scene?.targetId ?? ""), [catalog, scene?.visibleIds, scene?.targetId]);
  const modelIds = lessonModels(catalog, draft);
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
      const detailsMatch = JSON.stringify({
        title: draft.title,
        summary: draft.summary,
        cover: draft.cover,
        coverCrop: draft.coverCrop,
        scene: draft.scene,
        modelId: draft.modelId,
        modelIds: draft.modelIds,
      }) === JSON.stringify({
        title: saved.title,
        summary: saved.summary,
        cover: saved.cover,
        coverCrop: saved.coverCrop,
        scene: saved.scene,
        modelId: saved.modelId,
        modelIds: saved.modelIds,
      });
      setSavedStep(detailsMatch);
    } else {
      const savedStepData = saved.steps.find(s => s.id === active.id);
      if (savedStepData) {
        setSavedStep(JSON.stringify(active) === JSON.stringify(savedStepData));
      } else {
        setSavedStep(false);
      }
    }
  }, [selected, active, draft.title, draft.summary, draft.cover, draft.coverCrop, draft.scene, draft.modelId, draft.modelIds, saved]);

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
      const savedStepData = saved.steps.find(s => s.id === active.id);
      const savedSceneStep = savedStepData && savedStepData.kind !== "text" ? savedStepData : saved.scene;
      if (savedSceneStep) {
        setSavedView(JSON.stringify({ visibleIds: scene.visibleIds, view: scene.view })
          === JSON.stringify({ visibleIds: savedSceneStep.visibleIds, view: savedSceneStep.view }));
      } else {
        setSavedView(false);
      }
    }
  }, [selected, scene, active, saved]);

  function updateDraft(patch: Partial<Lesson>) {
    setError("");
    setSaveNotice("");
    setSavedStep(false);
    const next = { ...draft, ...patch };
    setDraft(next);
    onDraftChange?.(next);
    return next;
  }

  function updateActive(value: LessonStep) {
    setSavedStep(false);
    setSaveNotice("");
    return updateDraft({ steps: draft.steps.map(step => step.id === value.id ? value : step) });
  }

  function updateScene(visibleIds: string[], view: SceneView | undefined = scene?.view) {
    const patch = { targetId: sceneTargetId, visibleIds, view };
    setSavedView(false);
    setSavedStep(false);
    setSaveNotice("");
    if (!active) return updateDraft({ scene: patch });
    return updateActive(active.kind === "identify_structure" ? { ...active, ...patch }
      : { ...active, kind: "observe", ...patch });
  }

  function persist(next: Lesson) {
    setError("");
    setDraft(next);
    return onChange(next);
  }

  function changeModels(nextModelIds: string[]) {
    const currentModelIds = draft.modelIds?.length ? draft.modelIds : (draft.modelId ? [draft.modelId] : []);
    const prevKey = currentModelIds.slice().sort().join(",");
    const nextKey = nextModelIds.slice().sort().join(",");
    if (prevKey === nextKey) return;

    const hadScenes = !!(draft.scene?.view || draft.scene?.visibleIds?.length
      || draft.steps.some(step => step.kind !== "text" && (step.targetId || step.visibleIds)));
    const removedRoots = currentModelIds.filter(id => !nextModelIds.includes(id));

    if (removedRoots.length > 0 && hadScenes && !window.confirm(t("lessons.confirmSceneReset"))) return;

    const primaryId = nextModelIds[0] ?? "";
    const removedMembers = new Set(removedRoots.flatMap(id => catalog.members(id)));
    const cleanVisibleIds = (ids?: string[]) => ids ? ids.filter(id => !removedMembers.has(id)) : undefined;

    persist({
      ...draft,
      modelId: primaryId,
      modelIds: nextModelIds,
      scene: nextModelIds.length === 0 ? undefined : (draft.scene ? {
        ...draft.scene,
        targetId: removedRoots.includes(draft.scene.targetId) ? primaryId : draft.scene.targetId,
        visibleIds: cleanVisibleIds(draft.scene.visibleIds),
      } : undefined),
      steps: draft.steps.map(step => {
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
    const currentModelIds = draft.modelIds?.length ? draft.modelIds : (draft.modelId ? [draft.modelId] : []);
    const newModelIds = [...new Set([...currentModelIds, ...rootsForIds])];
    const modelId = draft.modelId || newModelIds[0];
    if (!modelId) { setError(t("lessons.targetError")); return; }
    const patch = { targetId: sceneTargetId || modelId, view: scene?.view,
      visibleIds: [...new Set([...(scene?.visibleIds ?? catalog.members(sceneTargetId)), ...ids])] };
    persist({
      ...draft,
      modelId,
      modelIds: newModelIds,
      steps: draft.steps.map(step => {
        if (draft.modelId && step.id !== active?.id) return step;
        return step.kind === "identify_structure" ? { ...step, ...patch } : { ...step, kind: "observe", ...patch };
      }),
    });
  }

  function select(id?: string) {
    setError("");
    setSaveNotice("");
    setRevealPart(undefined);
    onSelect(id);
  }

  function save() {
    let nextDraft = draft;
    if (showModel && hasModel) {
      const snapshot = sceneHandle.current?.capture();
      if (!snapshot) { setError(t("lessons.sceneSaveUnavailable")); return; }
      const patch = { targetId: sceneTargetId, visibleIds: snapshot.visibleIds, view: snapshot.view };
      if (!active) {
        nextDraft = { ...draft, scene: patch };
      } else {
        nextDraft = {
          ...draft,
          steps: draft.steps.map(step => step.id === active.id
            ? (step.kind === "identify_structure" ? { ...step, ...patch } : { ...step, kind: "observe", ...patch })
            : step),
        };
      }
    }
    const success = onChange(nextDraft);
    if (success) {
      setDraft(nextDraft);
      setSavedStep(true);
      setSavedView(true);
      setSaveNotice(t(active ? "lessons.stepSaved" : "lessons.detailsSaved"));
    }
  }

  function saveView(view: SceneView, ids: string[]) {
    const patch = { targetId: sceneTargetId, visibleIds: ids, view };
    const nextDraft: Lesson = !active
      ? { ...draft, scene: patch }
      : {
        ...draft,
        steps: draft.steps.map(step => step.id === active.id
          ? (step.kind === "identify_structure" ? { ...step, ...patch } : { ...step, kind: "observe", ...patch })
          : step),
      };
    const success = onChange(nextDraft);
    if (success) {
      setDraft(nextDraft);
      setSavedView(true);
      setSavedStep(true);
      setSaveNotice(t(active ? "lessons.stepSaved" : "lessons.detailsSaved"));
    }
  }

  function add() {
    const base = { id: newLessonId(), title: emptyText, instruction: emptyText, showModel: active?.showModel };
    const step: LessonStep = hasModel
      ? { ...base, kind: "observe", targetId: scene?.targetId ?? primaryModelId, visibleIds: scene?.visibleIds, view: scene?.view }
      : { ...base, kind: "text" };
    const insertion = active ? index + 1 : draft.steps.length;
    const nextDraft = { ...draft, steps: [...draft.steps.slice(0, insertion), step, ...draft.steps.slice(insertion)] };
    persist(nextDraft);
    select(step.id);
    focusAdded.current = step.id;
  }

  function move(from: number, to: number) {
    if (from < 0 || from >= draft.steps.length || to < 0 || to >= draft.steps.length || from === to) return;
    const steps = [...draft.steps];
    const step = steps.splice(from, 1)[0]!;
    steps.splice(to, 0, step);
    const nextDraft = { ...draft, steps };
    persist(nextDraft);
    setOrderStatus(t("lessons.stepMoved", { name: lessonText(step.title, language) || t("lessons.untitledSection"), position: to + 1 }));
  }

  function remove() {
    if (!active || !window.confirm(t("lessons.confirmRemoveBlock"))) return;
    const steps = draft.steps.filter(step => step.id !== active.id);
    const nextDraft = { ...draft, steps };
    persist(nextDraft);
    select((steps[index] ?? steps[index - 1])?.id);
  }

  async function exportDraft() {
    setExporting(true);
    try {
      readLesson(draft, true);
      setError("");
      await exportLesson(draft, language);
    } catch (cause) {
      if (cause instanceof LessonValidationError) {
        select(cause.step ? draft.steps[cause.step - 1]?.id : undefined);
        setError(t(`lessons.validation.${cause.reason}`, { step: cause.step }));
      } else setError(t("lessons.exportError"));
    } finally { setExporting(false); }
  }

  const title = active?.title ?? draft.title;
  const body = active?.instruction ?? draft.summary;
  const sceneTargetId = scene && targets.some(target => target.id === scene.targetId) ? scene.targetId : primaryModelId;
  const hasModel = modelIds.length > 0 && modelIds.some(id => catalog.roots.some(model => model.id === id));
  const showModel = !!active && active.showModel !== false;
  const renderScene = showModel && hasModel;

  return <div className="lesson-editor study-shell" data-outline={outlineOpen}>
    {renderScene && sceneFrame && sceneControls && <EditorScene modelIds={modelIds} targetId={sceneTargetId}
      visibleIds={scene?.visibleIds} view={scene?.view} sectionId={active?.id ?? draft.id} sceneRef={sceneHandle}
      revealPart={revealPart} saved={savedView}
      onSaveView={saveView}
      onChangeScene={ids => hasModel ? updateScene(ids) : addStructures(ids)}
      onSceneChange={() => { setSavedView(false); setSaveNotice(""); }}
      frame={sceneFrame} controls={sceneControls} inactive={false} />}
    <header className="app-menu-bar lesson-author-bar">
      <div className="app-menu-history">
        <button className="controls-info" aria-label={t("lessons.library")} title={t("lessons.library")} onClick={onBack}>
          <LineIcon name="arrow-small-left" size={18} />
          {t("lessons.exit")}
        </button>
      </div>
      <div className="lesson-author-heading">
        <h1 className="app-menu-title" ref={heading} tabIndex={-1}>{lessonText(draft.title, language) || t("lessons.editor")}</h1>
        {saveFailed ? <button className="lesson-save-retry" onClick={() => onChange(draft)} title={t("lessons.saveError")}>{t("lessons.retry")}</button>
          : <span>{t(showModel && hasModel ? "lessons.contentSaved" : "lessons.saved")}</span>}
      </div>
      <div className="app-menu-actions lesson-author-actions">
        <div className="lesson-languages" role="group" aria-label={t("lessons.writingLanguage")}>
          {(["vi", "en"] as const).map(value => {
            const isConfigured = !draft.languages || draft.languages.includes(value);
            return <button key={value} type="button" aria-pressed={editorLanguage === value}
              disabled={!isConfigured}
              aria-label={value === "vi" ? "Tiếng Việt" : "English"}
              title={!isConfigured ? t("lessons.languageDisabled") : (value === "vi" ? "Tiếng Việt" : "English")}
              onClick={() => { if (isConfigured) setLocale(value); }}>{value.toUpperCase()}</button>;
          })}
        </div>
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
        <LessonOutline steps={draft.steps} selected={selected} onSelect={select} onMove={move} />
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
      {showModel && <div className="lesson-scene-region lesson-model" onPointerDownCapture={() => { setSavedView(false); setSaveNotice(""); }}
        onWheelCapture={() => { setSavedView(false); setSaveNotice(""); }} onKeyDownCapture={() => { setSavedView(false); setSaveNotice(""); }}>
        <div className="lesson-scene-viewport" ref={setSceneFrame}>
        {!renderScene && <div className="lesson-scene-placeholder workspace-panel-surface">
          <span className="lesson-block-icon" aria-hidden="true">3D</span>
          <p>{t("lessons.scenePlaceholder")}</p>
        </div>}
        </div>
        <div className="lesson-editor-hud">
          <LessonModelSetup catalog={catalog} modelId={draft.modelId} modelIds={modelIds} targetId={sceneTargetId}
            visibleIds={visibleIds} selectedPart={revealPart?.id} onSelectPart={(id, target) => setRevealPart({ id, target })}
            onModel={changeModel} onModels={changeModels} onChoose={addStructures}
            onChangeScene={ids => hasModel ? updateScene(ids) : addStructures(ids)} />
          {renderScene && <div className="lesson-scene-controls" ref={setSceneControls} />}
        </div>
      </div>}
      <section className="lesson-author-document workspace-panel-surface" id="lesson-author-writing"
        aria-label={t("lessons.writing")}>
        <div className="lesson-editor-stepbar">
          {active && <span>{t("lessons.step", { current: index + 1, total: draft.steps.length })}</span>}
          <div className="lesson-editor-stepbar-actions">
            <button className="lesson-button lesson-primary" data-saved={savedStep} disabled={savedStep} onClick={save}>
              {savedStep ? t("lessons.savedShort") : t(active ? "lessons.saveStep" : "lessons.saveDetails")}
            </button>
            <button className="lesson-button" onClick={add}>{t("lessons.addStep")}</button>
          </div>
        </div>
        <p className="lesson-save-status sr-only" role="status">{saveFailed ? t("lessons.saveError") : saveNotice}</p>
        <div className="information-content">
          <label className={active ? "sr-only" : "lesson-details-label"} htmlFor="lesson-write-title">{t(active ? "lessons.stepTitle" : "lessons.title")}{active ? ` (${editorLanguage.toUpperCase()})` : ""}</label>
          <input id="lesson-write-title" className="lesson-write-title" ref={titleField} value={title[editorLanguage]}
            placeholder={t(active ? "lessons.stepTitle" : "lessons.title")} lang={editorLanguage}
            onChange={event => {
              const value = { ...title, [editorLanguage]: event.target.value };
              if (active) updateActive({ ...active, title: value });
              else updateDraft({ title: value });
            }} />
          {active && <LessonStepOptions catalog={catalog} active={active} onChange={updateActive} />}
          {active && lessonMode(active) !== "questions" ? <Suspense fallback={<p role="status">{t("lessons.loadingEditor")}</p>}>
            <RichEditor key={`${active?.id ?? draft.id}/${editorLanguage}`} value={body} language={editorLanguage}
              label={`${t(active ? "lessons.instruction" : "lessons.summary")} (${editorLanguage.toUpperCase()})`}
              onChange={(value: LessonText) => {
                if (active) updateActive({ ...active, instruction: value });
                else updateDraft({ summary: value });
              }} />
          </Suspense> : !active && <LessonDetails lesson={draft} language={editorLanguage} onChange={updateDraft} />}
          {active && lessonMode(active) !== "content" && <LessonQuestionEditor
            questions={lessonQuestions(active, id => catalog.target(id)?.names)} locale={editorLanguage}
            onChange={questions => updateActive(updateLessonQuestions(active, lessonMode(active), questions))} />}
          {!active && !draft.steps.length && <p className="lesson-document-hint">{t("lessons.firstBlock")}</p>}
          {active && <div className="lesson-step-management">
            <button className="lesson-button lesson-remove-block" onClick={remove}>{t("lessons.removeStep")}</button>
          </div>}
        </div>
      </section>
    </div>

    </div>
  </div>;
}
