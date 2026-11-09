import type { ReactNode } from "react";
import { useLanguage } from "../i18n";
import { LineIcon } from "../icons";
import { PopoverPanel } from "../popover-panel";
import { shortcutLabel } from "../shortcuts";
import { GraphicsControls } from "./graphics-controls";
import type { GraphicsSettings } from "../anatomy/viewer/graphics";

export function WorkspacePopoverButton({ target, action }: { target: string; action: "guide" | "settings" }) {
  const { t } = useLanguage();
  const label = t(action === "guide" ? "app.help" : "app.settings");
  return <button type="button" className="controls-info" popoverTarget={target} aria-label={label} title={`${label} (${shortcutLabel(action)})`}>
    <LineIcon name={action === "guide" ? "alert-circle" : "cog"} size={14} />
  </button>;
}

export function WorkspaceSettings({ id, graphics, onChange, children }: {
  id: string; graphics: GraphicsSettings; onChange: (settings: GraphicsSettings) => void; children?: ReactNode;
}) {
  const { t } = useLanguage();
  return <PopoverPanel id={id} className="settings-popover" contentClassName="settings-content"
    title={t("app.settings.title")} closeLabel={t("app.settings.close")}>
    {children}
    <GraphicsControls id={id} graphics={graphics} onChange={onChange} />
  </PopoverPanel>;
}

export function WorkspaceHelp({ id, children, footer }: { id: string; children: ReactNode; footer?: ReactNode }) {
  const { t } = useLanguage();
  return <PopoverPanel id={id} className="controls-guide" contentClassName="guide-content"
    title={t("controls.guide.title")} closeLabel={t("controls.guide.close")} footer={footer}>
    {children}
  </PopoverPanel>;
}
