import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { Catalog } from "../../anatomy/catalog/types";
import { translateMessage, useLanguage } from "../../i18n";
import type { Language } from "../../i18n";
import { LessonValidationError, lessonMode, lessonSceneStep, lessonText, readLesson, updateLessonQuestions } from "../shared/contract";
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
import { LessonOutline } from "./outline";
import { useGraphicsSettings } from "../../pages/use-graphics-settings";
import { LessonContentPanel, LessonHeader, LessonOutlinePanel, LessonStepNavigation, LessonWorkspace } from "../shared/workspace";
import { useLessonConfirm } from "../shared/confirm";
import { restoreSavedScene } from "./saved-scene";

const RichEditor = lazy(() => import("./rich-editor"));

export const emptyText = { vi: "", en: "" };

export function LessonEditor({ catalog, lesson, saved, selected, saving, saveFailed, initialLocale, onSelect, onChange, onDraftChange, onPreview, onBack }: {
  catalog: Catalog;
  lesson: Lesson;
  saved: Lesson;
  selected?: string;
  saving: boolean;
  saveFailed: boolean;
  initialLocale?: Language;
  onSelect: (id?: string) => void;
  onChange: (lesson: Lesson) => Promise<boolean>;
  onDraftChange?: (lesson: Lesson) => void;
  onPreview: (lesson: Lesson, locale: Language) => void;
  onBack: (lesson: Lesson) => void;
}) {
  const { language, t } = useLanguage();
  const confirm = useLessonConfirm();
  const [graphics] = useGraphicsSettings();
  const [draft, setDraft] = useState<Lesson>(lesson);
  const [locale, setLocale] = useState<Language | undefined>(initialLocale);
  const [error, setError] = useState("");
  const [saveNotice, setSaveNotice] = useState("");
  const [draftDirty, setDraftDirty] = useState(() => JSON.stringify(lesson) !== JSON.stringify(saved));
  const [sceneDirty, setSceneDirty] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [revealPart, setRevealPart] = useState<{ id: string; target?: boolean }>();
  const [orderStatus, setOrderStatus] = useState("");
  const [sceneFrame, setSceneFrame] = useState<HTMLDivElement | null>(null);
  const [resetVersion, setResetVersion] = useState(0);
  const [modelReloadVersion, setModelReloadVersion] = useState(0);
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false);
  const [previewScene, setPreviewScene] = useState<LessonScene & { modelIds: string[]; visibleIds: string[]; sceneRef?: string }>();
  const previewDirty = useRef(false);
  const [modelControlsHost, setModelControlsHost] = useState<HTMLDivElement | null>(null);
  const [modelActionsHost, setModelActionsHost] = useState<HTMLDivElement | null>(null);
  const modelSettingsOpener = useRef<HTMLButtonElement>(null);
  const editorLanguage = locale ?? language;
  const writingText: typeof t = (key, values) => translateMessage(key, editorLanguage, values);
  useEffect(() => {
    if (draft.languages?.length === 1 && editorLanguage !== draft.languages[0]) {
      setLocale(draft.languages[0]);
    }
  }, [draft.languages, editorLanguage]);
  useEffect(() => { setDraft(lesson); }, [lesson]);
  useEffect(() => { setModelSettingsOpen(false); setPreviewScene(undefined); previewDirty.current = false; }, [selected]);
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
    const edited = { ...next, preloadModelIds: undefined };
    setDraft(edited);
    onDraftChange?.(edited);
    return edited;
  }

  function resetScene() {
    if (!active) return;
    const restored = restoreSavedScene(active, savedBaseline, savedModelIds);
    if (restored.kind !== "text") replaceScenePreview(restored, savedModelIds, restored.sceneRef);
  }

  function updateDraft(patch: Partial<Lesson>) {
    return stage({ ...draft, ...patch });
  }

  function captureSceneDraft(captureUnchanged = false): Lesson | undefined {
    if ((!sceneDirty && !captureUnchanged) || !showModel || !hasModel) return draft;
    const snapshot = sceneHandle.current?.capture();
    if (!snapshot) { setError(t("lessons.sceneSaveUnavailable")); return; }
    const patch = { modelIds, targetId: sceneTargetId, visibleIds: snapshot.visibleIds, view: snapshot.view, sceneRef: undefined };
    if (!active) return { ...draft, scene: patch, sceneRef: undefined };
    return { ...draft, steps: draft.steps.map(step => step.id === active.id
      ? { ...step, kind: "observe", ...patch }
      : step) };
  }

  function stageSceneDraft() {
    let next = captureSceneDraft();
    if (next && sceneDirty) {
      if (next !== draft) next = stage(next);
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
    return stage(next);
  }

  function updateScene(visibleIds: string[], view: SceneView | undefined = scene?.view) {
    const live = sceneDirty ? sceneHandle.current?.capture() : undefined;
    if (sceneDirty && !live) { setError(t("lessons.sceneSaveUnavailable")); return; }
    const patch = { modelIds, targetId: sceneTargetId, visibleIds, view: live?.view ?? view, sceneRef: undefined };
    setSceneDirty(false);
    if (!active) return updateDraft({ scene: patch });
    return updateActive({ ...active, kind: "observe", ...patch });
  }

  function reloadModel() {
    if (!previewScene) return;
    const live = sceneHandle.current?.capture();
    if (!live) { setError(t("lessons.sceneSaveUnavailable")); return; }
    previewDirty.current = false;
    setPreviewScene({ ...previewScene, view: live.view });
    setModelReloadVersion(value => value + 1);
  }

  async function applyModelSettings() {
    if (!active || !previewScene) return;
    const nextModelIds = previewScene.modelIds;
    const currentModelIds = scene?.modelIds ?? modelIds;
    const removedRoots = currentModelIds.filter(id => !nextModelIds.includes(id));
    if (removedRoots.length && (scene?.targetId || scene?.view || scene?.visibleIds?.length)
      && !await confirm(t("lessons.confirmSceneReset"), t("lessons.continue"))) return;
    const live = previewDirty.current && nextModelIds.length ? sceneHandle.current?.capture() : undefined;
    if (previewDirty.current && nextModelIds.length && !live) { setError(t("lessons.sceneSaveUnavailable")); return; }
    const patch = {
      modelIds: nextModelIds,
      targetId: previewScene.targetId,
      visibleIds: previewScene.visibleIds,
      view: live?.view ?? previewScene.view,
      sceneRef: live ? undefined : previewScene.sceneRef,
    };
    setSceneDirty(false);
    updateActive({ ...active, kind: "observe", ...patch });
    closeModelSettings();
  }

  function previewVisibility(ids: string[], root?: { id: string; shown: boolean }) {
    if (!previewScene) return false;
    const live = previewDirty.current ? sceneHandle.current?.capture() : undefined;
    if (previewDirty.current && !live) { setError(t("lessons.sceneSaveUnavailable")); return false; }
    previewDirty.current = false;
    const selectedModels = root?.shown ? [...new Set([...previewScene.modelIds, root.id])]
      : previewScene.modelIds.filter(id => id !== root?.id);
    const nextModelIds = lessonSceneModels(catalog, { ...draft, modelIds: selectedModels, modelId: "" },
      { targetId: previewScene.targetId, visibleIds: ids });
    const keepTarget = previewScene.targetId && (!root || root.shown || nextModelIds.some(id =>
      lessonTargets(catalog, id).some(target => target.id === previewScene.targetId)));
    setPreviewScene({ ...previewScene, modelIds: nextModelIds,
      targetId: keepTarget ? previewScene.targetId : nextModelIds[0] ?? "",
      visibleIds: ids, view: live?.view ?? previewScene.view, sceneRef: undefined });
    return true;
  }

  function replaceScenePreview(source: LessonScene, ids: string[], sceneRef?: string) {
    previewDirty.current = false;
    setError("");
    setRevealPart(undefined);
    setPreviewScene({ modelIds: ids, targetId: source.targetId, view: source.view,
      visibleIds: source.visibleIds ?? catalog.members(source.targetId), sceneRef });
    setResetVersion(value => value + 1);
  }

  function openModelSettings(event: React.MouseEvent<HTMLButtonElement>) {
    const live = sceneDirty ? sceneHandle.current?.capture() : undefined;
    if (!stageSceneDraft()) return;
    modelSettingsOpener.current = event.currentTarget;
    previewDirty.current = false;
    setPreviewScene({ modelIds: [...modelIds], targetId: sceneTargetId,
      visibleIds: [...(live?.visibleIds ?? visibleIds)], view: live?.view ?? scene?.view, sceneRef: active?.sceneRef });
    setModelSettingsOpen(true);
  }

  function closeModelSettings() {
    setModelSettingsOpen(false);
    setPreviewScene(undefined);
    previewDirty.current = false;
    setRevealPart(undefined);
    setResetVersion(value => value + 1);
    requestAnimationFrame(() => (modelSettingsOpener.current?.isConnected ? modelSettingsOpener.current
      : sceneFrame?.querySelector<HTMLButtonElement>(".lesson-model-settings-trigger") ?? heading.current)?.focus({ preventScroll: true }));
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
    if (current) onPreview(current, editorLanguage);
  }

  function copyPreviousScene() {
    if (!active || index < 1) return;
    const previous = draft.steps[index - 1];
    const source = previous?.kind === "text" ? lessonSceneStep(draft, index - 1) : previous;
    if (!source) return;
    const copiedModels = lessonSceneModels(catalog, draft, source);
    if (!copiedModels.length) return;
    replaceScenePreview(source, copiedModels);
  }

  async function save() {
    if (saving) return;
    const revision = editRevision.current;
    const capturedDraft = captureSceneDraft(true);
    if (!capturedDraft) return;
    const nextDraft = capturedDraft === draft ? draft : { ...capturedDraft, preloadModelIds: undefined };
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
      await exportLesson(current, language, catalog);
    } catch (cause) {
      if (cause instanceof LessonValidationError) {
        select(cause.step ? draft.steps[cause.step - 1]?.id : undefined);
        setError(t(`lessons.validation.${cause.reason}`, { step: cause.step }));
      } else setError(t("lessons.exportError"));
    } finally { setExporting(false); }
  }

  const title = active?.title ?? draft.title;
  const body = active?.instruction ?? draft.summary;
  const writingLabel = active
    ? writingText("lessons.stepHeading", { current: index + 1,
      title: lessonText(active.title, editorLanguage) || writingText("lessons.untitledSection") })
    : writingText("lessons.details");
  const sceneTargetId = scene && targets.some(target => target.id === scene.targetId) ? scene.targetId : primarySceneModelId;
  const displayModelIds = previewScene?.modelIds ?? modelIds;
  const displayTargetId = previewScene?.targetId ?? sceneTargetId;
  const displayVisibleIds = previewScene?.visibleIds ?? visibleIds;
  const hasModel = displayModelIds.length > 0 && displayModelIds.some(id => catalog.roots.some(model => model.id === id));
  const showModel = !!active && active.showModel !== false;
  const renderScene = showModel && hasModel;
  const loadedModelIds = [...new Set([...lessonModels(catalog, draft), ...displayModelIds])];
  const previousStep = index > 0 ? draft.steps[index - 1] : undefined;
  const previousScene = previousStep?.kind === "text" ? lessonSceneStep(draft, index - 1) : previousStep;
  const savedIndex = saved.steps.findIndex(step => step.id === active?.id);
  const savedStep = saved.steps[savedIndex];
  const savedScene = savedStep?.kind === "text" ? lessonSceneStep(saved, savedIndex) : savedStep;
  const savedBaseline = savedStep ? savedScene ?? saved.scene : undefined;
  const savedModelIds = savedStep ? lessonSceneModels(catalog, saved, savedBaseline) : [];
  const canCopyPreviousScene = !!previousScene && previousScene.targetId !== ""
    && lessonSceneModels(catalog, draft, previousScene).length > 0;
  const modelSettingsButton = <button type="button" className="lesson-button lesson-model-settings-trigger"
    aria-controls="lesson-model-settings" aria-expanded={modelSettingsOpen} hidden={modelSettingsOpen}
    onClick={openModelSettings}>{t("lessons.modelSettings")}</button>;

  return <LessonWorkspace editing modelVisible={showModel} hasStep={!!active}
    background={sceneFrame && <EditorScene graphics={graphics} modelIds={loadedModelIds} targetId={displayTargetId}
      visibleIds={displayVisibleIds} view={previewScene ? previewScene.view : scene?.view} sectionId={active?.id ?? draft.id} sceneRef={sceneHandle}
      revealPart={revealPart}
      onChangeScene={ids => modelSettingsOpen ? previewVisibility(ids) : updateScene(ids)}
      onSceneChange={() => { if (modelSettingsOpen) previewDirty.current = true;
        else { editRevision.current++; setSceneDirty(true); setSaveNotice(""); } }}
      onReloadModel={reloadModel} reloadVersion={modelReloadVersion} resetVersion={resetVersion}
      frame={sceneFrame} settingsButton={modelSettingsButton} settingsControlsHost={modelSettingsOpen ? modelControlsHost : null}
      settingsActionsHost={modelSettingsOpen ? modelActionsHost : null}
      inactive={!renderScene} />}
    header={<LessonHeader editing title={lessonText(draft.title, language) || t("lessons.editor")}
      subtitle={t(isDirty ? "lessons.unsaved" : "lessons.saved")} lesson={saved} headingRef={heading}
      onBack={exit} backDisabled={saving}
      navigation={<button className="lesson-button lesson-primary" aria-label={t(isDirty ? "lessons.saveLesson" : "lessons.savedShort")}
          data-saved={!isDirty} disabled={!isDirty || saving || modelSettingsOpen} aria-busy={saving} onClick={save}>
          <span className="lesson-action-full">{t(isDirty ? "lessons.saveLesson" : "lessons.savedShort")}</span>
          <span className="lesson-action-short">{t(isDirty ? "lessons.saveLessonShort" : "lessons.savedShort")}</span>
        </button>}
      actions={<>
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
        <button className="lesson-button" aria-label={t("lessons.export")} disabled={exporting || modelSettingsOpen} aria-busy={exporting} onClick={() => void exportDraft()}>
          <span className="lesson-action-full">{t("lessons.export")}</span><span className="lesson-action-short">{t("lessons.exportShort")}</span>
        </button>
        <button className="lesson-button lesson-primary" aria-label={t("lessons.preview")} disabled={modelSettingsOpen} onClick={preview}>
          <span className="lesson-action-full">{t("lessons.preview")}</span><span className="lesson-action-short">{t("lessons.previewShort")}</span>
        </button>
      </>} />}
    outline={<LessonOutlinePanel editing id="lesson-author-outline">
        <button className="lesson-outline-row lesson-outline-details" aria-current={!active ? "true" : undefined} onClick={() => select()}>
          <span className="lesson-outline-label">{t("lessons.details")}</span>
        </button>
        <div className="lesson-outline-section-heading">
          <h3>{t("lessons.sectionList")}</h3>
          <button type="button" className="controls-info lesson-outline-add" aria-label={t("lessons.addStep")} title={t("lessons.addStep")} onClick={add} />
        </div>
        <LessonOutline steps={draft.steps} selected={selected} onSelect={select} onMove={move} onRemove={remove} />
    </LessonOutlinePanel>}
    beforeContent={<p className="sr-only" role="status">{orderStatus}</p>}>
      {(saveFailed || error || (active ? active.sceneRef : draft.sceneRef)) && <div className="lesson-author-alerts">
        {saveFailed && <p className="model-status model-error" role="alert">{t("lessons.saveError")}</p>}
        {error && <p className="model-status model-error" role="alert">{error}</p>}
        {(active ? active.sceneRef : draft.sceneRef) && <p className="model-status model-error" role="status">{t("lessons.sceneFileUnavailable")}</p>}
      </div>}
      <div className="lesson-scene-region lesson-model" hidden={!showModel} inert={!showModel} aria-hidden={!showModel}>
        <div className="lesson-scene-viewport" ref={setSceneFrame}>
        {!renderScene && <div className="model-canvas lesson-model-empty">
          <div className="lesson-scene-placeholder workspace-panel-surface">
            <span className="lesson-block-icon" aria-hidden="true">3D</span>
            <p>{t("lessons.scenePlaceholder")}</p>
            {modelSettingsButton}
          </div>
        </div>}
        </div>
      </div>
      <LessonContentPanel className={`lesson-author-document lesson-author-document--${active ? "step" : "details"}`} id="lesson-author-writing" inert={modelSettingsOpen}
        aria-label={writingLabel} expandable={!!active && !modelSettingsOpen}>
        <LessonStepNavigation editing position={active ? { current: index + 1, total: draft.steps.length } : undefined}
          onPrevious={active ? () => select(draft.steps[index - 1]?.id) : undefined} previousDisabled={index === 0}
          actions={<>
            {active && index < draft.steps.length - 1 && <button className="lesson-button"
              onClick={() => select(draft.steps[index + 1]?.id)}>{t("lessons.next")}</button>}
            {(!draft.steps.length || (active && index === draft.steps.length - 1))
              && <button className="lesson-button" onClick={add}>{t("lessons.addStep")}</button>}
          </>} />
        <p className="lesson-save-status sr-only" role="status">{saveFailed ? t("lessons.saveError") : saveNotice}</p>
        <p className="lesson-writing-language" role="status">{t("lessons.writingLanguage")}: <strong lang={editorLanguage}>{editorLanguage === "vi" ? "Tiếng Việt" : "English"}</strong></p>
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
        {active?.questionRef && <p className="model-status model-error" role="status">{t("lessons.questionFileUnavailable")}</p>}
        {active && lessonMode(active) !== "content" && <LessonQuestionEditor
          questions={active.questions ?? []} locale={editorLanguage}
          onChange={questions => updateActive(updateLessonQuestions(active, lessonMode(active), questions))} />}
        {!active && !draft.steps.length && <p className="lesson-document-hint">{t("lessons.firstBlock")}</p>}
        {active && <div className="lesson-management">
          <LessonStepOptions active={active} onChange={updateActive} />
          <button type="button" className="lesson-button lesson-remove-block" onClick={remove}>{t("lessons.removeStep")}</button>
        </div>}
      </LessonContentPanel>
      <section id="lesson-model-settings" className="lesson-model-settings workspace-panel-surface" data-open={modelSettingsOpen}
        aria-hidden={!modelSettingsOpen} inert={!modelSettingsOpen}
        role="region" aria-labelledby="lesson-model-settings-title">
        <LessonModelSetup catalog={catalog} targetId={displayTargetId} visibleIds={displayVisibleIds}
          selectedPart={revealPart?.id} settingsOpen={modelSettingsOpen} onCloseSettings={closeModelSettings}
          onApply={applyModelSettings} onChangeScene={previewVisibility}
          onSelectPart={(id, target) => setRevealPart({ id, target })}
          controls={<>
            <div ref={setModelControlsHost} />
            <div className="lesson-inspector-actions" ref={setModelActionsHost}>
              <button className="lesson-button" disabled={!displayModelIds.length && !savedModelIds.length}
                onClick={resetScene}>{t("lessons.resetStudyScene")}</button>
              {canCopyPreviousScene && <button className="lesson-button" onClick={copyPreviousScene}>{t("lessons.copyPreviousScene")}</button>}
            </div>
          </>} />
      </section>
  </LessonWorkspace>;
}
