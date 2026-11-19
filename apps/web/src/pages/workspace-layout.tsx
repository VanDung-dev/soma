import type { HTMLAttributes, ReactNode, Ref } from "react";
import { useLanguage, type MessageKey } from "../i18n";
import { LineIcon } from "../icons";
import { shortcutLabel, useShortcutBindings } from "../shortcuts";
import type { AppShortcut } from "../shortcuts";
import "./workspace.css";

export function WorkspaceLayout({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`workspace-shell ${className}`.trim()} {...props} />;
}

export function PageMessage({ title, description }: { title: MessageKey; description: MessageKey }) {
  const { t } = useLanguage();
  return <main className="page-message" aria-labelledby="page-message-title">
    <h1 id="page-message-title">{t(title)}</h1>
    <p>{t(description)}</p>
    <a href="/home">{t("app.returnHome")}</a>
  </main>;
}

export function WorkspaceMenu({ ref, className = "", actionsClassName = "", layout = "overlay", navigation, title, actions, children }: {
  ref?: Ref<HTMLElement>; className?: string; actionsClassName?: string; layout?: "overlay" | "inline";
  navigation: ReactNode; title: ReactNode; actions: ReactNode; children?: ReactNode;
}) {
  const { t } = useLanguage();
  return <header ref={ref} className={`app-menu-bar ${className}`.trim()} data-layout={layout} aria-label={t("app.navigation.label")}>
    <div className="app-menu-history">{navigation}</div>
    {title}
    <div className={`app-menu-actions ${actionsClassName}`.trim()}>{actions}</div>
    {children}
  </header>;
}

export function SidebarToggle({ id, controls, expanded, name, shortcut, onToggle }: {
  id?: string; controls: string; expanded: boolean; name: string; shortcut?: AppShortcut; onToggle: () => void;
}) {
  const { t } = useLanguage();
  useShortcutBindings();
  const label = t(expanded ? "panels.hide" : "panels.show", { name });
  return <button id={id} type="button" className="controls-info sidebar-toggle" aria-expanded={expanded} aria-controls={controls}
    aria-label={label} title={shortcut ? `${label}${shortcutLabel(shortcut) ? ` (${shortcutLabel(shortcut)})` : ""}` : label} onClick={onToggle}>
    <LineIcon name="sidebar" size={18} />
  </button>;
}
