import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { Catalog } from "../../anatomy/catalog/types";
import { translateMessage, useLanguage } from "../../i18n";
import type { Language } from "../../i18n";
import { LineIcon } from "../../icons";
import { LessonValidationError, lessonMode, lessonQuestions, lessonSceneStep, lessonText, readLesson, updateLessonQuestions } from "../shared/contract";
import type { Lesson, LessonScene, LessonStep, LessonText } from "../shared/contract";
import { EditorScene } from "./editor-scene";
import type { EditorSceneHandle } from "./editor-scene";
import { LessonModelSetup } from "./model-setup";
import { LessonDetails } from "./details";
import { LessonStepOptions } from "./step-options";
import { LessonQuestionEditor } from "./question-editor";
import { exportLesson, newLessonId } from "../shared/source";
import { lessonModels, lessonSceneModels, lessonTargets } from "../shared/targets";
import type { SceneView } from "../../anatomy/viewer/contracts";
import { useLessonPanel } from "../shared/panels";
import { LessonOutline } from "./outline";
import { useGraphicsSettings } from "../../pages/use-graphics-settings";
import { SidebarToggle, WorkspaceLayout, WorkspaceMenu } from "../../pages/workspace-layout";
import { useLessonConfirm } from "../shared/confirm";
import { restoreSavedScene } from "./saved-scene";

const RichEditor = lazy(() => import("./rich-editor"));

export const emptyText = { vi: "", en: "" };

export function LessonEditor({ catalog, lesson, saved, selected, saving, saveFailed, onSelect, onChange, onDraftChange, onPreview, onBack }: {
  catalog: Catalog;
  lesson: Lesson;
  saved: Lesson;
  selected?: string;
  saving: boolean;
  saveFailed: boolean;
  onSelect: (id?: string) => void;
  onChange: (lesson: Lesson) => Promise<boolean>;
  onDraftChange?: (lesson: Lesson) => void;
  onPreview: (lesson: Lesson) => void;
  onBack: (lesson: Lesson) => void;
}) {
  const { language, t } = useLanguage();
  const confirm = useLessonConfirm();
  const [graphics] = useGraphicsSettings();
  const [draft, setDraft] = useState<Lesson>(lesson);
  const [locale, setLocale] = useState<Language>();
  const [error, setError] = useState("");
  const [saveNotice, setSaveNotice] = useState("");
  const [draftDirty, setDraftDirty] = useState(() => JSON.stringify(lesson) !== JSON.stringify(saved));
  const [sceneDirty, setSceneDirty] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [outlineOpen, setOutlineOpen] = useLessonPanel("editorOutline", window.matchMedia("(min-width: 901px)").matches);
  const [revealPart, setRevealPart] = useState<{ id: string; target?: boolean }>();
  const [orderStatus, setOrderStatus] = useState("");
  const [sceneFrame, setSceneFrame] = useState<HTMLDivElement | null>(null);
  const [resetVersion, setResetVersion] = useState(0);
  const [modelReloadVersion, setModelReloadVersion] = useState(0);
  const editorLanguage = locale ?? language;
  const writingText: typeof t = (key, values) => translateMessage(key, editorLanguage, values);
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
  const modelIds = lessonSceneModels(catalog, draft, scene);
  const primarySceneModelId = modelIds[0] ?? primaryModelId;
  const visibleIds = useMemo(() => scene?.visibleIds ?? catalog.members(scene?.targetId ?? ""), [catalog, scene?.visibleIds, scene?.targetId]);
  const modelKey = modelIds.join(",");
  const targets = useMemo(() => modelKey.split(",").flatMap(id => lessonTargets(catalog, id)), [catalog, modelKey]);
  const isDirty = draftDirty || sceneDirty;
  const heading = useRef<HTMLHeadingElement>(null);
  const titleField = useRef<HTMLInputElement>(null);
  const focusAdded = useRef<string | null>(null);
  const sceneHandle = useRef<EditorSceneHandle>(null);
  const editRevision = useRef(0);
  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => {
    if (focusAdded.current && focusAdded.current === selected) {
      focusAdded.current = null;
      titleField.current?.focus();
    }
  }, [selected]);

  function stage(next: Lesson) {
    editRevision.current++;
    setError("");
    setSaveNotice("");
    setDraftDirty(true);
    setDraft(next);
    onDraftChange?.(next);
  }

  function resetScene() {
    if (!active) return;
    editRevision.current++;
    const savedIndex = saved.steps.findIndex(step => step.id === active.id);
    const savedStep = saved.steps[savedIndex];
    const savedScene = savedStep?.kind === "text" ? lessonSceneStep(saved, savedIndex) : savedStep;
    const baseline = savedStep ? savedScene ?? saved.scene : undefined;
    const next = { ...draft, steps: draft.steps.map(step => step.id === active.id
      ? restoreSavedScene(step, baseline, savedStep ? lessonSceneModels(catalog, saved, baseline) : []) : step) };
    setDraft(next);
    onDraftChange?.(next);
    setDraftDirty(JSON.stringify(next) !== JSON.stringify(saved));
    setSceneDirty(false);
    setError("");
    setSaveNotice("");
    setRevealPart(undefined);
    setResetVersion(value => value + 1);
  }

  function updateDraft(patch: Partial<Lesson>) {
    const next = { ...draft, ...patch };
    stage(next);
    return next;
  }

  function captureSceneDraft(): Lesson | undefined {
    if (!sceneDirty || !showModel || !hasModel) return draft;
    const snapshot = sceneHandle.current?.capture();
    if (!snapshot) { setError(t("lessons.sceneSaveUnavailable")); return; }
    const patch = { modelIds, targetId: sceneTargetId, visibleIds: snapshot.visibleIds, view: snapshot.view };
    if (!active) return { ...draft, scene: patch };
    return { ...draft, steps: draft.steps.map(step => step.id === active.id
      ? (step.kind === "identify_structure" ? { ...step, ...patch } : { ...step, kind: "observe", ...patch })
      : step) };
  }

  function stageSceneDraft() {
    const next = captureSceneDraft();
    if (next && sceneDirty) {
      if (next !== draft) stage(next);
      setSceneDirty(false);
    }
    return next;
  }

  function updateActive(value: LessonStep) {
    let nextValue = value;
    const sceneFields = ["modelIds", "targetId", "visibleIds", "view"] as const;
    const requested = value as LessonStep & Partial<LessonScene>;
    const previous = active as (LessonStep & Partial<LessonScene>) | undefined;
    const sceneChanged = !!previous && (value.showModel !== active?.showModel
      || sceneFields.some(field => JSON.stringify(requested[field]) !== JSON.stringify(previous[field])));
    if (sceneDirty && sceneChanged) {
      const captured = captureSceneDraft();
      if (!captured) return;
      const capturedStep = captured.steps.find(step => step.id === value.id);
      if (capturedStep) {
        const capturedScene = capturedStep as LessonStep & Partial<LessonScene>;
        nextValue = {
          ...value,
          ...Object.fromEntries(sceneFields.filter(field => JSON.stringify(requested[field]) === JSON.stringify(previous?.[field]))
            .map(field => [field, capturedScene[field]])),
          kind: value.kind === active?.kind ? capturedStep.kind : value.kind,
        } as LessonStep;
      }
      setSceneDirty(false);
    }
    const next = { ...draft, steps: draft.steps.map(step => step.id === value.id ? nextValue : step) };
    stage(next);
    return next;
  }

  function updateScene(visibleIds: string[], view: SceneView | undefined = scene?.view) {
    const live = sceneDirty ? sceneHandle.current?.capture() : undefined;
    if (sceneDirty && !live) { setError(t("lessons.sceneSaveUnavailable")); return; }
    const patch = { modelIds, targetId: sceneTargetId, visibleIds, view: live?.view ?? view };
    setSceneDirty(false);
    if (!active) return updateDraft({ scene: patch });
    return updateActive(active.kind === "identify_structure" ? { ...active, ...patch }
      : { ...active, kind: "observe", ...patch });
  }

  function reloadModel() {
    if (!stageSceneDraft()) return;
    setModelReloadVersion(value => value + 1);
  }

  async function changeModels(nextModelIds: string[]) {
    if (!active) return;
    const live = sceneDirty ? sceneHandle.current?.capture() : undefined;
    if (sceneDirty && !live) { setError(t("lessons.sceneSaveUnavailable")); return; }
    const currentModelIds = scene?.modelIds ?? modelIds;
    if (currentModelIds.slice().sort().join(",") === nextModelIds.slice().sort().join(",")) return;
    const removedRoots = currentModelIds.filter(id => !nextModelIds.includes(id));
    if (removedRoots.length && (scene?.targetId || scene?.view || scene?.visibleIds?.length)
      && !await confirm(t("lessons.confirmSceneReset"), t("lessons.continue"))) return;
    const removedMembers = new Set(removedRoots.flatMap(id => catalog.members(id)));
    const addedMembers = nextModelIds.filter(id => !currentModelIds.includes(id)).flatMap(id => catalog.members(id));
    const primaryId = nextModelIds[0] ?? "";
    const targetId = scene && nextModelIds.some(id => lessonTargets(catalog, id).some(target => target.id === scene.targetId))
      ? scene.targetId : primaryId;
    const patch = {
      modelIds: nextModelIds,
      targetId,
      visibleIds: [...new Set([
        ...(live?.visibleIds ?? visibleIds).filter(id => !removedMembers.has(id)),
        ...addedMembers,
      ])],
      view: live?.view ?? scene?.view,
    };
    setSceneDirty(false);
    updateActive(active.kind === "identify_structure" ? { ...active, ...patch }
      : { ...active, kind: "observe", ...patch });
  }

  function addStructures(ids: string[], partId?: string) {
    if (!active) return;
    const live = sceneDirty ? sceneHandle.current?.capture() : undefined;
    if (sceneDirty && !live) { setError(t("lessons.sceneSaveUnavailable")); return; }
    setRevealPart(partId ? { id: partId } : undefined);
    const rootsForIds = catalog.roots.filter(root => {
      const members = new Set(catalog.members(root.id));
      return ids.some(id => members.has(id));
    }).map(r => r.id);
    const newModelIds = [...new Set([...modelIds, ...rootsForIds])];
    const targetId = scene && newModelIds.some(id => lessonTargets(catalog, id).some(target => target.id === scene.targetId))
      ? scene.targetId : rootsForIds[0] ?? newModelIds[0] ?? "";
    if (!targetId) { setError(t("lessons.targetError")); return; }
    const patch = { modelIds: newModelIds, targetId,
      view: live?.view ?? scene?.view,
      visibleIds: [...new Set([...(live?.visibleIds ?? scene?.visibleIds ?? catalog.members(targetId)), ...ids])] };
    setSceneDirty(false);
    updateActive(active.kind === "identify_structure" ? { ...active, ...patch }
      : { ...active, kind: "observe", ...patch });
  }

  function select(id?: string) {
    if (!stageSceneDraft()) return;
    setError("");
    setSaveNotice("");
    setRevealPart(undefined);
    onSelect(id);
  }

  function exit() {
    if (saving) return;
    const current = stageSceneDraft();
    if (current) onBack(current);
  }

  function preview() {
    if (saving) return;
    const current = stageSceneDraft();
    if (current) onPreview(current);
  }

  function copyPreviousScene() {
    if (!active || index < 1) return;
    const previous = draft.steps[index - 1];
    const source = previous?.kind === "text" ? lessonSceneStep(draft, index - 1) : previous;
    if (!source) return;
    const copiedModels = lessonSceneModels(catalog, draft, source);
    if (!copiedModels.length) return;
    const patch = {
      modelIds: [...copiedModels],
      targetId: source.targetId,
      visibleIds: [...(source.visibleIds ?? catalog.members(source.targetId))],
      view: source.view && structuredClone(source.view),
    };
    updateActive(active.kind === "identify_structure" ? { ...active, ...patch }
      : { ...active, kind: "observe", ...patch });
  }

  async function save() {
    if (saving) return;
    const revision = editRevision.current;
    let nextDraft = draft;
    if (showModel && hasModel) {
      const snapshot = sceneHandle.current?.capture();
      if (!snapshot) { setError(t("lessons.sceneSaveUnavailable")); return; }
      const patch = { modelIds, targetId: sceneTargetId, visibleIds: snapshot.visibleIds, view: snapshot.view };
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
    const success = await onChange(nextDraft);
    if (success && editRevision.current === revision) {
      setDraft(nextDraft);
      setDraftDirty(false);
      setSceneDirty(false);
      setSaveNotice(t("lessons.lessonSaved"));
    }
  }

  function add() {
    const current = stageSceneDraft();
    if (!current) return;
    const step: LessonStep = { id: newLessonId(), title: emptyText, instruction: emptyText, showModel: true,
      kind: "observe", modelIds: [], targetId: "" };
    const nextDraft = { ...current, steps: [...current.steps, step] };
    stage(nextDraft);
    setSceneDirty(false);
    setRevealPart(undefined);
    onSelect(step.id);
    focusAdded.current = step.id;
  }

  function move(from: number, to: number) {
    const current = stageSceneDraft();
    if (!current || from < 0 || from >= current.steps.length || to < 0 || to >= current.steps.length || from === to) return;
    const steps = [...current.steps];
    const step = steps.splice(from, 1)[0]!;
    steps.splice(to, 0, step);
    const nextDraft = { ...current, steps };
    stage(nextDraft);
    setOrderStatus(t("lessons.stepMoved", { name: lessonText(step.title, language) || t("lessons.untitledSection"), position: to + 1 }));
  }

  async function remove() {
    if (!active || !await confirm(t("lessons.confirmRemoveBlock"), t("lessons.removeStep"))) return;
    const steps = draft.steps.filter(step => step.id !== active.id);
    const nextDraft = { ...draft, steps };
    stage(nextDraft);
    setSceneDirty(false);
    onSelect((steps[index] ?? steps[index - 1])?.id);
  }

  async function exportDraft() {
    setExporting(true);
    try {
      const current = stageSceneDraft();
      if (!current) return;
      readLesson(current, true);
      setError("");
      await exportLesson(current, language);
    } catch (cause) {
      if (cause instanceof LessonValidationError) {
        select(cause.step ? draft.steps[cause.step - 1]?.id : undefined);
        setError(t(`lessons.validation.${cause.reason}`, { step: cause.step }));
      } else setError(t("lessons.exportError"));
    } finally { setExporting(false); }
  }

  const title = active?.title ?? draft.title;
  const body = active?.instruction ?? draft.summary;
  const sceneTargetId = scene && targets.some(target => target.id === scene.targetId) ? scene.targetId : primarySceneModelId;
  const hasModel = modelIds.length > 0 && modelIds.some(id => catalog.roots.some(model => model.id === id));
  const showModel = !!active && active.showModel !== false;
  const renderScene = showModel && hasModel;
  const loadedModelIds = lessonModels(catalog, draft);
  const previousStep = index > 0 ? draft.steps[index - 1] : undefined;
  const previousScene = previousStep?.kind === "text" ? lessonSceneStep(draft, index - 1) : previousStep;
  const savedIndex = saved.steps.findIndex(step => step.id === active?.id);
  const savedStep = saved.steps[savedIndex];
  const savedScene = savedStep?.kind === "text" ? lessonSceneStep(saved, savedIndex) : savedStep;
  const canRestoreSavedModel = !!savedStep && lessonSceneModels(catalog, saved, savedScene ?? saved.scene).length > 0;
  const canCopyPreviousScene = !!previousScene && previousScene.targetId !== ""
    && lessonSceneModels(catalog, draft, previousScene).length > 0;
  const modelSetup = <LessonModelSetup catalog={catalog} modelId={modelIds[0] ?? ""} modelIds={modelIds} targetId={sceneTargetId}
    visibleIds={visibleIds} selectedPart={revealPart?.id} onSelectPart={(id, target) => {
      setRevealPart({ id, target });
      setSceneDirty(true);
      setSaveNotice("");
    }}
    onModel={id => changeModels(id ? [id] : [])} onModels={changeModels} onChoose={addStructures}
    onChangeScene={ids => hasModel ? updateScene(ids) : addStructures(ids)} />;

  return <WorkspaceLayout className="lesson-editor study-shell" data-outline={outlineOpen}>
    {sceneFrame && <EditorScene graphics={graphics} modelIds={loadedModelIds} targetId={sceneTargetId}
      visibleIds={scene?.visibleIds} view={scene?.view} sectionId={active?.id ?? draft.id} sceneRef={sceneHandle}
      revealPart={revealPart}
      onChangeScene={ids => hasModel ? updateScene(ids) : addStructures(ids)}
      onSceneChange={() => { editRevision.current++; setSceneDirty(true); setSaveNotice(""); }}
      onResetScene={resetScene} onReloadModel={reloadModel} reloadVersion={modelReloadVersion} resetVersion={resetVersion}
      frame={sceneFrame} tools={modelSetup} inactive={!renderScene} outlineOpen={outlineOpen} />}
    <WorkspaceMenu className="lesson-author-bar" layout="inline" actionsClassName="lesson-author-actions" navigation={<>
        <SidebarToggle id="lesson-toggle-outline" controls="lesson-author-outline" expanded={outlineOpen}
          name={t("lessons.outline")} onToggle={() => setOutlineOpen(!outlineOpen)} />
        <button className="controls-info lesson-exit" aria-label={t("lessons.exit")} title={t("lessons.exit")} disabled={saving} onClick={exit}>
          <LineIcon name="arrow-small-left" size={18} />
          {t("lessons.exit")}
        </button>
        <button className="lesson-button lesson-primary" aria-label={t(isDirty ? "lessons.saveLesson" : "lessons.savedShort")}
          data-saved={!isDirty} disabled={!isDirty || saving} aria-busy={saving} onClick={save}>
          <span className="lesson-action-full">{t(isDirty ? "lessons.saveLesson" : "lessons.savedShort")}</span>
          <span className="lesson-action-short">{t(isDirty ? "lessons.saveLessonShort" : "lessons.savedShort")}</span>
        </button>
      </>} title={<div className="lesson-author-heading">
        <h1 className="app-menu-title" ref={heading} tabIndex={-1}>{lessonText(draft.title, language) || t("lessons.editor")}</h1>
        <span>{t(isDirty ? "lessons.unsaved" : "lessons.saved")}</span>
      </div>} actions={<>
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
        <button className="lesson-button lesson-primary" aria-label={t("lessons.preview")} onClick={preview}>
          <span className="lesson-action-full">{t("lessons.preview")}</span><span className="lesson-action-short">{t("lessons.previewShort")}</span>
        </button>
      </>} />
    <div className="lesson-author-workspace" data-outline={outlineOpen}>
    <nav className="workspace-panel-surface lesson-author-outline" id="lesson-author-outline" hidden={!outlineOpen} inert={!outlineOpen} aria-hidden={!outlineOpen}
      aria-label={t("lessons.outline")}>
      <div className="catalog-heading"><h2>{t("lessons.outline")}</h2></div>
      <div className="catalog-tree">
        <button className="lesson-outline-row lesson-outline-details" aria-current={!active ? "true" : undefined} onClick={() => select()}>
          <span className="lesson-block-icon" aria-hidden="true">≡</span>
          <span>{t("lessons.details")}</span>
        </button>
        <LessonOutline steps={draft.steps} selected={selected} onSelect={select} onMove={move} onRemove={remove} />
        <button type="button" className="lesson-outline-row lesson-tool" onClick={add}>
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
      <div className="lesson-scene-region lesson-model" hidden={!showModel} inert={!showModel} aria-hidden={!showModel}>
        <div className="lesson-scene-viewport" ref={setSceneFrame}>
        {!renderScene && <div className="model-canvas lesson-model-empty">
          <div className="lesson-scene-placeholder workspace-panel-surface">
            <span className="lesson-block-icon" aria-hidden="true">3D</span>
            <p>{t("lessons.scenePlaceholder")}</p>
            {modelIds.length === 0 && <div className="lesson-scene-placeholder-actions">
              <button className="lesson-button lesson-primary" popoverTarget="lesson-model-settings">{t("lessons.modelSettings")}</button>
              {canRestoreSavedModel && <button className="lesson-button" onClick={resetScene}>{t("lessons.resetStudyScene")}</button>}
              {canCopyPreviousScene && <button className="lesson-button" onClick={copyPreviousScene}>{t("lessons.copyPreviousScene")}</button>}
            </div>}
          </div>
          <div className="lesson-model-tools">{modelSetup}</div>
        </div>}
        </div>
      </div>
      <section className="lesson-author-document workspace-panel-surface" id="lesson-author-writing"
        aria-label={t("lessons.writing")}>
        <div className="lesson-editor-stepbar">
          {active && <button className="lesson-button lesson-step-previous" disabled={index === 0}
            onClick={() => select(draft.steps[index - 1]?.id)}>{t("lessons.previous")}</button>}
          {active && <span>{t("lessons.step", { current: index + 1, total: draft.steps.length })}</span>}
          <div className="lesson-editor-stepbar-actions">
            {active && index < draft.steps.length - 1 && <button className="lesson-button"
              onClick={() => select(draft.steps[index + 1]?.id)}>{t("lessons.next")}</button>}
            {(!draft.steps.length || (active && index === draft.steps.length - 1))
              && <button className="lesson-button" onClick={add}>{t("lessons.addStep")}</button>}
          </div>
        </div>
        <p className="lesson-save-status sr-only" role="status">{saveFailed ? t("lessons.saveError") : saveNotice}</p>
        <p className="lesson-writing-language" role="status">{t("lessons.writingLanguage")}: <strong lang={editorLanguage}>{editorLanguage === "vi" ? "Tiếng Việt" : "English"}</strong></p>
        <div className="information-content">
          <label className={active ? "sr-only" : "lesson-details-label"} htmlFor="lesson-write-title" lang={editorLanguage}>{writingText(active ? "lessons.stepTitle" : "lessons.title")}</label>
          <input id="lesson-write-title" className="lesson-write-title" ref={titleField} value={title[editorLanguage]}
            placeholder={writingText(active ? "lessons.stepTitle" : "lessons.title")} lang={editorLanguage}
            onChange={event => {
              const value = { ...title, [editorLanguage]: event.target.value };
              if (active) updateActive({ ...active, title: value });
              else updateDraft({ title: value });
            }} />
          {active && lessonMode(active) !== "questions" ? <Suspense fallback={<p role="status">{t("lessons.loadingEditor")}</p>}>
            <RichEditor key={`${active?.id ?? draft.id}/${editorLanguage}`} value={body} language={editorLanguage}
              label={writingText(active ? "lessons.instruction" : "lessons.summary")}
              onChange={(value: LessonText) => {
                if (active) updateActive({ ...active, instruction: value });
                else updateDraft({ summary: value });
              }} />
          </Suspense> : !active && <LessonDetails lesson={draft} language={editorLanguage} onChange={updateDraft} />}
          {active && lessonMode(active) !== "content" && <LessonQuestionEditor
            questions={lessonQuestions(active, id => catalog.target(id)?.names)} locale={editorLanguage}
            onChange={questions => updateActive(updateLessonQuestions(active, lessonMode(active), questions))} />}
          {!active && !draft.steps.length && <p className="lesson-document-hint">{t("lessons.firstBlock")}</p>}
        </div>
        {active && <div className="lesson-management">
          <LessonStepOptions catalog={catalog} active={active} onChange={updateActive} />
          <button type="button" className="lesson-button lesson-remove-block" onClick={remove}>{t("lessons.removeStep")}</button>
        </div>}
      </section>
    </div>

    </div>
  </WorkspaceLayout>;
}
