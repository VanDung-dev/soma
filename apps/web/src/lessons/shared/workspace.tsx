import { createContext, useContext, useId, useState } from "react";
import type { ButtonHTMLAttributes, HTMLAttributes, KeyboardEventHandler, ReactNode, Ref, UIEventHandler } from "react";
import { LineIcon } from "../../icons";
import { useLanguage } from "../../i18n";
import type { Language } from "../../i18n";
import { WorkspaceLayout, WorkspaceMenu } from "../../pages/workspace-layout";
import type { Lesson, LessonStep } from "./contract";
import { lessonSectionTitle } from "./sections";
import type { LessonWorkspaceMode } from "./sections";
import { LessonTimestamps } from "./timestamps";

const LessonWorkspaceModeContext = createContext<LessonWorkspaceMode>("edit");

export function LessonWorkspaceLayout({
  mode, header, background, outline, modelVisible, hasStep, bodyRef, onScroll, beforeContent, notices,
  scene, sceneHostRef, modelRegionId, document, inspector,
}: {
  mode: LessonWorkspaceMode;
  header: ReactNode;
  background?: ReactNode;
  outline: ReactNode;
  modelVisible: boolean;
  hasStep?: boolean;
  bodyRef?: Ref<HTMLDivElement>;
  onScroll?: UIEventHandler<HTMLDivElement>;
  beforeContent?: ReactNode;
  notices?: ReactNode;
  scene: ReactNode;
  sceneHostRef?: Ref<HTMLDivElement>;
  modelRegionId?: string;
  document: ReactNode;
  inspector?: ReactNode;
}) {
  const { t } = useLanguage();
  const editing = mode === "edit";
  const ModelRegion = editing ? "div" : "section";
  return <LessonWorkspaceModeContext value={mode}>
    <WorkspaceLayout className={`lesson-workspace-shell ${editing ? "lesson-editor study-shell" : "lesson-player"}`} data-lesson-mode={mode}>
      {background}
      {header}
      <div className={`lesson-workspace-body ${editing ? "lesson-author-workspace" : "lesson-player-body"}`} ref={bodyRef}>
        {outline}
        {beforeContent}
        <div className={`lesson-workspace-main ${editing ? "lesson-author-center" : "lesson-workspace"}`}
          data-step={hasStep} data-model={modelVisible} onScroll={onScroll}>
          {notices}
          <ModelRegion className={editing ? "lesson-scene-region lesson-model" : "lesson-model lesson-model-surface"}
            id={modelRegionId} hidden={!modelVisible} inert={!modelVisible} aria-hidden={!modelVisible}
            aria-label={editing ? undefined : t("viewer.section.label")}>
            {editing ? <div className="lesson-scene-viewport" ref={sceneHostRef}>{scene}</div> : scene}
          </ModelRegion>
          {document}
          {inspector}
        </div>
      </div>
    </WorkspaceLayout>
  </LessonWorkspaceModeContext>;
}

export function LessonHeader({
  title, subtitle, lesson, headingRef, onBack, backDisabled, navigation, actions,
}: {
  title: string;
  subtitle: ReactNode;
  lesson: Pick<Lesson, "createdAt" | "updatedAt">;
  headingRef?: Ref<HTMLHeadingElement>;
  onBack: () => void;
  backDisabled?: boolean;
  navigation?: ReactNode;
  actions: ReactNode;
}) {
  const { t } = useLanguage();
  const editing = useContext(LessonWorkspaceModeContext) === "edit";
  return <WorkspaceMenu className={`lesson-header ${editing ? "lesson-author-bar" : "lesson-player-header"}`} layout="inline"
    actionsClassName={editing ? "lesson-author-actions" : undefined}
    navigation={<>
      <button className="controls-info lesson-exit" aria-label={t("lessons.exit")} title={t("lessons.exit")} disabled={backDisabled} onClick={onBack}>
        <LineIcon name="arrow-small-left" size={18} />
        {t("lessons.exit")}
      </button>
      {navigation}
    </>}
    title={<div className={`lesson-heading ${editing ? "lesson-author-heading" : "lesson-player-heading"}`}>
      <h1 className={editing ? "app-menu-title" : undefined} ref={headingRef} tabIndex={headingRef ? -1 : undefined}>{title}</h1>
      <span>{subtitle}</span>
      <LessonTimestamps lesson={lesson} />
    </div>}
    actions={actions} />;
}

export function LessonOutlinePanel({ id, children }: {
  id?: string;
  children: ReactNode;
}) {
  const { t } = useLanguage();
  const editing = useContext(LessonWorkspaceModeContext) === "edit";
  return <nav className={`workspace-panel-surface lesson-outline-panel ${editing ? "lesson-author-outline" : "lesson-reader-outline"}`}
    id={id} aria-label={t("lessons.outline")}>
    <div className="catalog-heading"><h2>{t("lessons.outline")}</h2></div>
    <div className="catalog-tree">{children}</div>
  </nav>;
}

export function LessonOutlineRow({ label, indicator, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  indicator?: ReactNode;
}) {
  return <button className="lesson-outline-row" {...props}>
    {indicator}
    <strong className="lesson-outline-label">{label}</strong>
  </button>;
}

type SectionRowOptions = {
  item?: HTMLAttributes<HTMLLIElement> & Record<`data-${string}`, string | boolean | undefined>;
  button?: ButtonHTMLAttributes<HTMLButtonElement>;
  controls?: ReactNode;
  indicator?: ReactNode;
};

export function LessonSectionList({ steps, selected, language, fallback = true, onSelect, configureRow, ref, onKeyDown }: {
  steps: readonly LessonStep[];
  selected?: string;
  language: Language;
  fallback?: boolean;
  onSelect: (id: string, index: number) => void;
  configureRow: (step: LessonStep, index: number, title: string, current: boolean) => SectionRowOptions;
  ref?: Ref<HTMLOListElement>;
  onKeyDown?: KeyboardEventHandler<HTMLOListElement>;
}) {
  const { t } = useLanguage();
  const untitled = t("lessons.untitledSection");
  return <ol className="lesson-outline-list" ref={ref} onKeyDown={onKeyDown}>
    {steps.map((step, index) => {
      const current = step.id === selected;
      const label = lessonSectionTitle(step, language, untitled, fallback);
      const { item, button, controls, indicator } = configureRow(step, index, label, current);
      return <li key={step.id} className="lesson-outline-item" {...item}>
        {controls}
        <LessonOutlineRow {...button} label={label} indicator={indicator} aria-current={current ? "true" : undefined}
          onClick={() => onSelect(step.id, index)} />
      </li>;
    })}
  </ol>;
}

export function LessonStepNavigation({ position, onPrevious, previousDisabled, actions }: {
  position?: { current: number; total: number };
  onPrevious?: () => void;
  previousDisabled?: boolean;
  actions: ReactNode;
}) {
  const { t } = useLanguage();
  const editing = useContext(LessonWorkspaceModeContext) === "edit";
  return <div className={`lesson-step-navigation lesson-editor-stepbar${editing ? "" : " lesson-player-stepbar"}`}>
    {onPrevious && <button className="lesson-button lesson-step-previous" disabled={previousDisabled} onClick={onPrevious}>{t("lessons.previous")}</button>}
    {position && <span>{t("lessons.step", position)}</span>}
    <div className="lesson-editor-stepbar-actions">{actions}</div>
  </div>;
}

export function LessonContentPanel({ className, id, expandable, ...props }: HTMLAttributes<HTMLElement> & {
  expandable?: boolean;
}) {
  const { t } = useLanguage();
  const generatedId = useId();
  const panelId = id ?? generatedId;
  const [expanded, setExpanded] = useState(false);
  const label = t(expanded ? "lessons.collapseWritingPanel" : "lessons.expandWritingPanel");

  return <>
    {expandable && <button type="button" className="panel-edge-toggle lesson-author-width-toggle"
      aria-controls={panelId} aria-expanded={expanded} aria-label={label}
      title={label} onClick={() => setExpanded(value => !value)}>
      <LineIcon name="chevron-wide-right" size={24} />
    </button>}
    <section id={panelId} className={`lesson-content-panel workspace-panel-surface ${className ?? "lesson-step"}`}
      data-expanded={expanded || undefined} {...props} />
  </>;
}
