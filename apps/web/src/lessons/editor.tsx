import { useEffect, useMemo, useRef, useState } from "react";
import type { Catalog } from "../anatomy/catalog/types";
import { useLanguage } from "../i18n";
import type { Language } from "../i18n";
import { LineIcon } from "../icons";
import { LessonValidationError, lessonSceneStep, lessonText, readLesson, validateLessonTargets } from "./contract";
import type { Lesson, LessonStep, LessonText } from "./contract";
import { EditorScene } from "./editor-scene";
import { LessonInspector } from "./inspector";
import { exportLesson, newLessonId } from "./source";
import { lessonTargets } from "./targets";
import type { SceneView } from "../anatomy/viewer/contracts";

export const emptyText = { vi: "", en: "" };
type Panel = "outline" | "inspector";

export function LessonEditor({ catalog, lesson, selected, saveFailed, onSelect, onChange, onPreview, onBack }: {
  catalog: Catalog;
  lesson: Lesson;
  selected?: string;
  saveFailed: boolean;
  onSelect: (id?: string) => void;
  onChange: (lesson: Lesson) => void;
  onPreview: () => void;
  onBack: () => void;
}) {
  const { language, t } = useLanguage();
  const [locale, setLocale] = useState<Language>();
  const [error, setError] = useState("");
  const [panel, setPanel] = useState<Panel>();
  const [sceneFrame, setSceneFrame] = useState<HTMLDivElement | null>(null);
  const [sceneControls, setSceneControls] = useState<HTMLDivElement | null>(null);
  const editorLanguage = locale ?? language;
  const index = lesson.steps.findIndex(step => step.id === selected);
  const active = lesson.steps[index];
  const scene = lessonSceneStep(lesson, Math.max(0, index));
  const outlineOpen = panel === "outline";
  const inspectorOpen = panel === "inspector";
  const panelOverCanvas = !!panel;
  const targets = useMemo(() => lessonTargets(catalog, lesson.modelId), [catalog, lesson.modelId]);
  const heading = useRef<HTMLHeadingElement>(null);
  const titleField = useRef<HTMLInputElement>(null);
  const focusAdded = useRef<string | null>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => {
    if (panel) document.getElementById(`lesson-author-${panel}`)?.focus({ preventScroll: true });
  }, [panel]);
  useEffect(() => {
    if (focusAdded.current && focusAdded.current === selected) {
      focusAdded.current = null;
      titleField.current?.focus();
    }
  }, [selected]);

  function update(patch: Partial<Lesson>) {
    setError("");
    onChange({ ...lesson, ...patch });
  }

  function updateActive(value: LessonStep) {
    update({ steps: lesson.steps.map(step => step.id === value.id ? value : step) });
  }

  function updateScene(visibleIds: string[], view: SceneView | undefined = scene?.view) {
    if (!active) return;
    const patch = { targetId: sceneTargetId, visibleIds, view };
    updateActive(active.kind === "identify_structure" ? { ...active, ...patch }
      : { ...active, kind: "observe", ...patch });
  }

  function changeModel(modelId: string) {
    if (lesson.modelId === modelId) return;
    if (lesson.modelId && lesson.steps.some(step => step.kind !== "text" && (step.targetId || step.visibleIds))
      && !window.confirm(t("lessons.confirmSceneReset"))) return;
    update({ modelId, steps: lesson.steps.map(step => {
      if (!modelId && step.kind !== "identify_structure") {
        return { id: step.id, title: step.title, instruction: step.instruction, kind: "text" };
      }
      const patch = { targetId: modelId, visibleIds: undefined, view: undefined };
      return step.kind === "identify_structure" ? { ...step, ...patch, choiceIds: [], answerId: "" }
        : { ...step, kind: "observe", ...patch };
    }) });
  }

  function openInspector() {
    setPanel("inspector");
  }

  function select(id?: string) {
    setPanel(undefined);
    onSelect(id);
  }

  function togglePanel(panel: Panel) {
    setPanel(value => value === panel ? undefined : panel);
  }

  function closePanel() {
    document.getElementById(`lesson-toggle-${panel}`)?.focus({ preventScroll: true });
    setPanel(undefined);
  }

  function add() {
    const base = { id: newLessonId(), title: emptyText, instruction: emptyText };
    const step: LessonStep = lesson.modelId
      ? { ...base, kind: "observe", targetId: scene?.targetId ?? lesson.modelId, visibleIds: scene?.visibleIds, view: scene?.view }
      : { ...base, kind: "text" };
    const insertion = active ? index + 1 : lesson.steps.length;
    update({ steps: [...lesson.steps.slice(0, insertion), step, ...lesson.steps.slice(insertion)] });
    select(step.id);
    focusAdded.current = step.id;
  }

  function move(offset: number) {
    const steps = [...lesson.steps];
    [steps[index], steps[index + offset]] = [steps[index + offset]!, steps[index]!];
    update({ steps });
  }

  function remove() {
    if (!active || !window.confirm(t("lessons.confirmRemoveBlock"))) return;
    const steps = lesson.steps.filter(step => step.id !== active.id);
    update({ steps });
    select((steps[index] ?? steps[index - 1])?.id);
  }

  function exportDraft() {
    try {
      readLesson(lesson);
      const root = catalog.roots.find(item => item.id === lesson.modelId);
      validateLessonTargets(lesson, root ? catalog.members(root.id) : [], id => catalog.members(id));
      setError("");
      exportLesson(lesson);
    } catch (cause) {
      if (cause instanceof LessonValidationError) {
        select(cause.step ? lesson.steps[cause.step - 1]?.id : undefined);
        if (["target", "scope", "choices", "overlap"].includes(cause.reason)) openInspector();
        setError(t(`lessons.validation.${cause.reason}`, { step: cause.step }));
      } else setError(t("lessons.exportError"));
    }
  }

  const title = active?.title ?? lesson.title;
  const body = active?.instruction ?? lesson.summary;
  const sceneTargetId = scene && targets.some(target => target.id === scene.targetId) ? scene.targetId : lesson.modelId;
  const hasModel = catalog.roots.some(model => model.id === lesson.modelId);
  const renderScene = !!scene && hasModel;
  const panelToggle = (panel: Panel, name: string, expanded: boolean) => {
    const label = t(expanded ? "panels.hide" : "panels.show", { name });
    return <button type="button" id={`lesson-toggle-${panel}`} className="lesson-button lesson-panel-toggle" aria-expanded={expanded}
      aria-controls={`lesson-author-${panel}`} aria-label={label} title={label} onClick={() => togglePanel(panel)}>
      <LineIcon name="sidebar" size={18} />
      <span className="lesson-action-full">{name}</span>
    </button>;
  };

  return <div className="lesson-editor study-shell" data-outline={outlineOpen} data-inspector={inspectorOpen}
    onKeyDown={event => {
      if (panelOverCanvas && event.key === "Escape" && !event.defaultPrevented && !event.nativeEvent.isComposing && !document.querySelector(":popover-open")) {
        event.preventDefault();
        closePanel();
      }
    }}>
    {renderScene && sceneFrame && sceneControls && <EditorScene modelId={lesson.modelId} targetId={sceneTargetId}
      visibleIds={scene.visibleIds} view={scene.view} sectionId={active?.id ?? scene.id}
      canSave={!!active} onSaveView={(view, ids) => updateScene(ids, view)} onChangeScene={ids => updateScene(ids)}
      frame={sceneFrame} controls={sceneControls} inactive={panelOverCanvas} />}
    <header className="app-menu-bar lesson-author-bar">
      <div className="app-menu-history">
        <button className="controls-info" aria-label={t("lessons.library")} title={t("lessons.library")} onClick={onBack}>
          <LineIcon name="arrow-small-left" size={18} />
        </button>
        {panelToggle("outline", t("lessons.outline"), outlineOpen)}
      </div>
      <div className="lesson-author-heading">
        <h1 className="app-menu-title" ref={heading} tabIndex={-1}>{lessonText(lesson.title, language) || t("lessons.editor")}</h1>
        {saveFailed ? <button className="lesson-save-retry" onClick={() => onChange(lesson)} title={t("lessons.saveError")}>{t("lessons.retry")}</button>
          : <span>{t("lessons.saved")}</span>}
      </div>
      <div className="app-menu-actions lesson-author-actions">
        <button className="lesson-button" aria-label={t("lessons.export")} onClick={exportDraft}>
          <span className="lesson-action-full">{t("lessons.export")}</span><span className="lesson-action-short">{t("lessons.exportShort")}</span>
        </button>
        <button className="lesson-button lesson-primary" aria-label={t("lessons.preview")} onClick={onPreview}>
          <span className="lesson-action-full">{t("lessons.preview")}</span><span className="lesson-action-short">{t("lessons.previewShort")}</span>
        </button>
        {panelToggle("inspector", t("lessons.settings"), inspectorOpen)}
      </div>
    </header>
    {panelOverCanvas && <button className="lesson-panel-scrim" onClick={closePanel}
      aria-label={t("panels.hide", { name: t(panel === "outline" ? "lessons.outline" : "lessons.settings") })} />}
    <nav className="catalog-panel lesson-author-outline" id="lesson-author-outline" data-open={outlineOpen}
      data-collapsed={!outlineOpen} inert={!outlineOpen} tabIndex={-1} aria-label={t("lessons.outline")}>
      <div className="catalog-heading"><h2>{t("lessons.outline")}</h2></div>
      <div className="catalog-tree">
        <button className="lesson-outline-row" aria-current={!active ? "true" : undefined} onClick={() => select()}>
          <span className="lesson-block-icon" aria-hidden="true">≡</span>
          <span>{t("lessons.details")}</span>
        </button>
        {lesson.steps.length > 0 && <ol className="lesson-outline-list">
          {lesson.steps.map((step, i) => {
            return <li key={step.id}><button className="lesson-outline-row"
              aria-current={step.id === active?.id ? "true" : undefined} onClick={() => select(step.id)}>
              <span className="lesson-block-icon" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
              <span><strong>{lessonText(step.title, language) || t("lessons.untitledSection")}</strong>
                {step.kind === "identify_structure" && <small>{t("lessons.kind.identify")}</small>}</span>
            </button></li>;
          })}
        </ol>}
        <div className="lesson-author-tools">
          <button className="lesson-outline-row lesson-tool" onClick={add}>
            <span className="lesson-block-icon" aria-hidden="true">+</span>
            <span>{t("lessons.addStep")}</span>
          </button>
        </div>
      </div>
    </nav>

    <div className="lesson-author-center">
      {(saveFailed || error) && <div className="lesson-author-alerts">
        {saveFailed && <p className="model-status model-error" role="alert">{t("lessons.saveError")}</p>}
        {error && <p className="model-status model-error" role="alert">{error}</p>}
      </div>}
      <div className="lesson-scene-region lesson-model" inert={panelOverCanvas}>
        <div className="lesson-scene-viewport" ref={setSceneFrame}>
        {!renderScene && <div className="lesson-scene-placeholder workspace-panel-surface">
          <span className="lesson-block-icon" aria-hidden="true">3D</span>
          <p>{t(hasModel ? "lessons.addSceneHint" : "lessons.scenePlaceholder")}</p>
          <button className="lesson-button" onClick={() => hasModel ? setPanel("outline") : openInspector()}>{t(hasModel ? "lessons.addContent" : "lessons.settings")}</button>
        </div>}
        </div>
        {renderScene && <div className="lesson-scene-controls" ref={setSceneControls} />}
      </div>
      <section className="lesson-author-document workspace-panel-surface" id="lesson-author-writing"
        inert={panelOverCanvas} aria-label={t("lessons.writing")}>
        <div className="information-content">
          <div className="lesson-document-meta">
            <span>{t(active ? "lessons.learningStep" : "lessons.details")}</span>
            <div className="lesson-languages" role="group" aria-label={t("lessons.writingLanguage")}>
              {(["vi", "en"] as const).map(value => <button key={value} type="button" aria-pressed={editorLanguage === value}
                aria-label={value === "vi" ? "Tiếng Việt" : "English"} onClick={() => setLocale(value)}>{value.toUpperCase()}</button>)}
            </div>
          </div>
          <label className="sr-only" htmlFor="lesson-write-title">{t(active ? "lessons.stepTitle" : "lessons.title")} ({editorLanguage.toUpperCase()})</label>
          <input id="lesson-write-title" className="lesson-write-title" ref={titleField} value={title[editorLanguage]}
            placeholder={t(active ? "lessons.stepTitle" : "lessons.title")} lang={editorLanguage}
            onChange={event => {
              const value = { ...title, [editorLanguage]: event.target.value };
              if (active) updateActive({ ...active, title: value });
              else update({ title: value });
            }} />
          <label className="sr-only" htmlFor="lesson-write-body">{t(active ? "lessons.instruction" : "lessons.summary")} ({editorLanguage.toUpperCase()})</label>
          <textarea id="lesson-write-body" className="lesson-write-body" value={body[editorLanguage]} lang={editorLanguage}
            rows={12} placeholder={t(active?.kind === "identify_structure" ? "lessons.writeQuestion"
              : active ? "lessons.writeContent" : "lessons.writeSummary")}
            onChange={event => {
              const value: LessonText = { ...body, [editorLanguage]: event.target.value };
              if (active) updateActive({ ...active, instruction: value });
              else update({ summary: value });
            }} />
          {!active && !lesson.steps.length && <p className="lesson-document-hint">{t("lessons.firstBlock")}</p>}
        </div>
      </section>
    </div>

    <LessonInspector catalog={catalog} lesson={lesson} active={active} scene={scene} index={index} locale={editorLanguage} targets={targets}
      open={inspectorOpen} collapsed={!inspectorOpen}
      onModel={changeModel} onChange={updateActive} onMove={move} onRemove={remove} />
  </div>;
}
