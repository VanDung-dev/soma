import { useEffect, useMemo, useRef, useState } from "react";
import type { Catalog } from "../anatomy/catalog/types";
import { desktopPanelQuery } from "../anatomy/viewer/layout";
import { useLanguage } from "../i18n";
import type { Language } from "../i18n";
import { LineIcon } from "../icons";
import { LessonValidationError, lessonText, readLesson, validateLessonTargets } from "./contract";
import type { Lesson, LessonStep, LessonText } from "./contract";
import { EditorScene } from "./editor-scene";
import { LessonInspector, lessonBlockTools as tools } from "./inspector";
import { exportLesson, newLessonId } from "./source";
import { lessonTargets } from "./targets";

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
  const [desktop, setDesktop] = useState(() => window.matchMedia(desktopPanelQuery).matches);
  const [collapsed, setCollapsed] = useState({ outline: false, inspector: false });
  const [mobilePanel, setMobilePanel] = useState<Panel>();
  const [writingOpen, setWritingOpen] = useState(true);
  const [sceneFrame, setSceneFrame] = useState<HTMLDivElement | null>(null);
  const [sceneControls, setSceneControls] = useState<HTMLDivElement | null>(null);
  const editorLanguage = locale ?? language;
  const index = lesson.steps.findIndex(step => step.id === selected);
  const active = lesson.steps[index];
  const sceneStep = !!active && active.kind !== "text";
  const outlineOpen = desktop ? !collapsed.outline : mobilePanel === "outline";
  const inspectorOpen = desktop ? !collapsed.inspector : mobilePanel === "inspector";
  const panelOverCanvas = !desktop && !!mobilePanel;
  const targets = useMemo(() => lessonTargets(catalog, lesson.modelId), [catalog, lesson.modelId]);
  const heading = useRef<HTMLHeadingElement>(null);
  const titleField = useRef<HTMLInputElement>(null);
  const focusAdded = useRef<string | null>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => {
    const query = window.matchMedia(desktopPanelQuery);
    const sync = () => { setDesktop(query.matches); setMobilePanel(undefined); };
    query.addEventListener("change", sync);
    sync();
    return () => query.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    if (!desktop && mobilePanel) document.getElementById(`lesson-author-${mobilePanel}`)?.focus({ preventScroll: true });
  }, [desktop, mobilePanel]);
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

  function changeModel(modelId: string) {
    if (lesson.modelId === modelId) return;
    if (lesson.modelId && lesson.steps.some(step => step.kind !== "text" && (step.targetId || step.visibleIds))
      && !window.confirm(t("lessons.confirmSceneReset"))) return;
    update({ modelId, steps: lesson.steps.map(step => step.kind === "text" ? step : { ...step, targetId: modelId, visibleIds: undefined }) });
  }

  function openInspector() {
    if (desktop) setCollapsed(value => ({ ...value, inspector: false }));
    else setMobilePanel("inspector");
  }

  function select(id?: string) {
    setMobilePanel(undefined);
    setWritingOpen(true);
    onSelect(id);
  }

  function togglePanel(panel: Panel) {
    if (desktop) setCollapsed(value => ({ ...value, [panel]: !value[panel] }));
    else setMobilePanel(value => value === panel ? undefined : panel);
  }

  function closeMobilePanel() {
    document.getElementById(`lesson-toggle-${mobilePanel}`)?.focus({ preventScroll: true });
    setMobilePanel(undefined);
  }

  function add(kind: LessonStep["kind"]) {
    const base = { id: newLessonId(), title: emptyText, instruction: emptyText };
    const step: LessonStep = kind === "identify_structure" ? {
      ...base, kind, targetId: lesson.modelId, choiceIds: [], answerId: "", explanation: emptyText,
    } : kind === "observe" ? { ...base, kind, targetId: lesson.modelId } : { ...base, kind };
    const insertion = active ? index + 1 : lesson.steps.length;
    update({ steps: [...lesson.steps.slice(0, insertion), step, ...lesson.steps.slice(insertion)] });
    select(step.id);
    if (kind !== "text") openInspector();
    if (desktop || kind === "text") focusAdded.current = step.id;
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

  function useLesson(action: () => void) {
    try {
      readLesson(lesson);
      const root = catalog.roots.find(item => item.id === lesson.modelId);
      validateLessonTargets(lesson, root ? catalog.members(root.id) : [], id => catalog.members(id));
      setError("");
      action();
    } catch (cause) {
      if (cause instanceof LessonValidationError) {
        select(cause.step ? lesson.steps[cause.step - 1]?.id : undefined);
        if (["target", "scope", "choices", "overlap"].includes(cause.reason)) openInspector();
        setError(t(`lessons.validation.${cause.reason}`, { step: cause.step }));
      } else setError(t("lessons.exportError"));
    }
  }

  const tool = tools.find(item => item.kind === active?.kind);
  const title = active?.title ?? lesson.title;
  const body = active?.instruction ?? lesson.summary;
  const sceneTargetId = sceneStep && targets.some(target => target.id === active.targetId) ? active.targetId : lesson.modelId;
  const renderScene = sceneStep && catalog.roots.some(model => model.id === lesson.modelId);
  const panelToggle = (panel: Panel, name: string, expanded: boolean) => {
    const label = t(expanded ? "panels.hide" : "panels.show", { name });
    return <button type="button" id={`lesson-toggle-${panel}`} className="controls-info sidebar-toggle" aria-expanded={expanded}
      aria-controls={`lesson-author-${panel}`} aria-label={label} title={label} onClick={() => togglePanel(panel)}>
      <LineIcon name="sidebar" size={18} />
    </button>;
  };

  return <div className="lesson-editor study-shell" data-outline={outlineOpen} data-inspector={inspectorOpen} data-scene={sceneStep}
    onKeyDown={event => {
      if (panelOverCanvas && event.key === "Escape" && !event.defaultPrevented && !event.nativeEvent.isComposing) {
        event.preventDefault();
        closeMobilePanel();
      }
    }}>
    {renderScene && sceneFrame && sceneControls && <EditorScene modelId={lesson.modelId} targetId={sceneTargetId} sectionId={active.id}
      visibleIds={active.visibleIds} onChangeScene={visibleIds => updateActive({ ...active, targetId: sceneTargetId, visibleIds })}
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
        {sceneStep && <button className="controls-info lesson-writer-toggle" aria-controls="lesson-author-writing"
          aria-label={t("lessons.writing")} title={t("lessons.writing")} aria-expanded={writingOpen} onClick={() => {
            setWritingOpen(panelOverCanvas || !writingOpen);
            setMobilePanel(undefined);
          }}><LineIcon name="sidebar" size={18} /></button>}
        <button className="lesson-button" aria-label={t("lessons.export")} onClick={() => useLesson(() => exportLesson(lesson))}>
          <span className="lesson-action-full">{t("lessons.export")}</span><span className="lesson-action-short">{t("lessons.exportShort")}</span>
        </button>
        <button className="lesson-button lesson-primary" aria-label={t("lessons.preview")} onClick={() => useLesson(onPreview)}>
          <span className="lesson-action-full">{t("lessons.preview")}</span><span className="lesson-action-short">{t("lessons.previewShort")}</span>
        </button>
        {panelToggle("inspector", t("lessons.settings"), inspectorOpen)}
      </div>
    </header>
    {panelOverCanvas && <button className="lesson-panel-scrim" onClick={closeMobilePanel}
      aria-label={t("panels.hide", { name: t(mobilePanel === "outline" ? "lessons.outline" : "lessons.settings") })} />}
    <nav className="catalog-panel lesson-author-outline" id="lesson-author-outline" data-open={outlineOpen}
      data-collapsed={collapsed.outline} inert={!outlineOpen} tabIndex={-1} aria-label={t("lessons.outline")}>
      <div className="catalog-heading"><h2>{t("lessons.outline")}</h2></div>
      <div className="catalog-tree">
        <button className="lesson-outline-row" aria-current={!active ? "true" : undefined} onClick={() => select()}>
          <span className="lesson-block-icon" aria-hidden="true">≡</span>
          <span>{t("lessons.details")}</span>
        </button>
        {lesson.steps.length > 0 && <ol className="lesson-outline-list">
          {lesson.steps.map((step, i) => {
            const item = tools.find(option => option.kind === step.kind)!;
            return <li key={step.id}><button className="lesson-outline-row"
              aria-current={step.id === active?.id ? "true" : undefined} onClick={() => select(step.id)}>
              <span className="lesson-block-icon" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
              <span><strong>{lessonText(step.title, language) || t(item.name)}</strong><small>{t(item.name)}</small></span>
            </button></li>;
          })}
        </ol>}
        <div className="lesson-author-tools">
          <h2>{t("lessons.addContent")}</h2>
          {tools.map(item => <button key={item.kind} className="lesson-outline-row lesson-tool" onClick={() => add(item.kind)}>
            <span className="lesson-block-icon" aria-hidden="true">{item.icon}</span>
            <span>{t(item.name)}</span><span aria-hidden="true">+</span>
          </button>)}
        </div>
      </div>
    </nav>

    <div className="lesson-author-center" inert={panelOverCanvas}>
      <div className="lesson-author-alerts">
        {saveFailed && <p className="model-status model-error" role="alert">{t("lessons.saveError")}</p>}
        {error && <p className="model-status model-error" role="alert">{error}</p>}
      </div>
      {sceneStep && <div className="lesson-scene-region">
        <div className="lesson-scene-viewport" ref={setSceneFrame}>
        {!renderScene && <div className="lesson-scene-placeholder workspace-panel-surface">
          <span className="lesson-block-icon" aria-hidden="true">3D</span>
          <p>{t("lessons.scenePlaceholder")}</p>
          <button className="lesson-button" onClick={openInspector}>{t("lessons.settings")}</button>
        </div>}
        </div>
        {renderScene && <div className="lesson-scene-controls" ref={setSceneControls} />}
      </div>}
      <section className="lesson-author-document workspace-panel-surface" id="lesson-author-writing"
        hidden={sceneStep && !writingOpen} aria-label={t("lessons.writing")}>
        <div className="information-content">
          <div className="lesson-document-meta">
            <span>{tool ? t(tool.name) : t("lessons.details")}</span>
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
            rows={sceneStep ? 2 : active?.kind === "text" ? 9 : 4} placeholder={t(active?.kind === "identify_structure" ? "lessons.writeQuestion"
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

    <LessonInspector catalog={catalog} lesson={lesson} active={active} index={index} locale={editorLanguage} targets={targets}
      open={inspectorOpen} collapsed={collapsed.inspector}
      onModel={changeModel} onChange={updateActive} onMove={move} onRemove={remove} />
  </div>;
}
