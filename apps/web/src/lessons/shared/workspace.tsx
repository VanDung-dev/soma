import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode, Ref, UIEventHandler } from "react";
import { LineIcon } from "../../icons";
import { useLanguage } from "../../i18n";
import { SidebarToggle, WorkspaceLayout, WorkspaceMenu } from "../../pages/workspace-layout";
import type { Lesson } from "./contract";
import { LessonTimestamps } from "./timestamps";

export function LessonWorkspace({
  editing = false, header, background, outline, outlineOpen, modelVisible, hasStep, bodyRef, onScroll, beforeContent, children,
}: {
  editing?: boolean;
  header: ReactNode;
  background?: ReactNode;
  outline: ReactNode;
  outlineOpen: boolean;
  modelVisible: boolean;
  hasStep?: boolean;
  bodyRef?: Ref<HTMLDivElement>;
  onScroll?: UIEventHandler<HTMLDivElement>;
  beforeContent?: ReactNode;
  children: ReactNode;
}) {
  return <WorkspaceLayout className={`lesson-workspace-shell ${editing ? "lesson-editor study-shell" : "lesson-player"}`}
    data-outline={editing ? outlineOpen : undefined}>
    {background}
    {header}
    <div className={`lesson-workspace-body ${editing ? "lesson-author-workspace" : "lesson-player-body"}`} ref={bodyRef} data-outline={outlineOpen}>
      {outline}
      {beforeContent}
      <div className={`lesson-workspace-main ${editing ? "lesson-author-center" : "lesson-workspace"}`}
        data-step={hasStep} data-model={modelVisible} onScroll={onScroll}>
        {children}
      </div>
    </div>
  </WorkspaceLayout>;
}

export function LessonHeader({
  editing = false, title, subtitle, lesson, headingRef, outlineId, outlineToggleId, outlineOpen, onToggleOutline,
  onBack, backDisabled, navigation, actions,
}: {
  editing?: boolean;
  title: string;
  subtitle: ReactNode;
  lesson: Pick<Lesson, "createdAt" | "updatedAt">;
  headingRef?: Ref<HTMLHeadingElement>;
  outlineId: string;
  outlineToggleId?: string;
  outlineOpen: boolean;
  onToggleOutline: () => void;
  onBack: () => void;
  backDisabled?: boolean;
  navigation?: ReactNode;
  actions: ReactNode;
}) {
  const { t } = useLanguage();
  return <WorkspaceMenu className={`lesson-header ${editing ? "lesson-author-bar" : "lesson-player-header"}`} layout="inline"
    actionsClassName={editing ? "lesson-author-actions" : undefined}
    navigation={<>
      <SidebarToggle id={outlineToggleId} controls={outlineId} expanded={outlineOpen} name={t("lessons.outline")} onToggle={onToggleOutline} />
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

export function LessonOutlinePanel({ id, open, editing = false, children }: {
  id: string;
  open: boolean;
  editing?: boolean;
  children: ReactNode;
}) {
  const { t } = useLanguage();
  return <nav className={`workspace-panel-surface lesson-outline-panel ${editing ? "lesson-author-outline" : "lesson-reader-outline"}`}
    id={id} hidden={!open} inert={!open} aria-hidden={!open} aria-label={t("lessons.outline")}>
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

export function LessonStepNavigation({ editing = false, position, onPrevious, previousDisabled, actions }: {
  editing?: boolean;
  position?: { current: number; total: number };
  onPrevious?: () => void;
  previousDisabled?: boolean;
  actions: ReactNode;
}) {
  const { t } = useLanguage();
  return <div className={`lesson-step-navigation lesson-editor-stepbar${editing ? "" : " lesson-player-stepbar"}`}>
    {onPrevious && <button className="lesson-button lesson-step-previous" disabled={previousDisabled} onClick={onPrevious}>{t("lessons.previous")}</button>}
    {position && <span>{t("lessons.step", position)}</span>}
    <div className="lesson-editor-stepbar-actions">{actions}</div>
  </div>;
}

export function LessonContentPanel({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={`lesson-content-panel workspace-panel-surface ${className ?? "lesson-step"}`} {...props} />;
}
