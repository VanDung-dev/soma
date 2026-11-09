import { useEffect, useId, useState } from "react";
import { GraphicsControls } from "../../anatomy/graphics-controls";
import { cameraControlGroups } from "../../anatomy/camera-controls";
import { graphicsStorageKey, readGraphicsSettings } from "../../anatomy/viewer/graphics";
import type { GraphicsSettings } from "../../anatomy/viewer/graphics";
import { useLanguage } from "../../i18n";
import { LineIcon } from "../../icons";
import { PopoverPanel } from "../../popover-panel";
import { shortcutAction, shortcutLabel } from "../../shortcuts";

export function useLessonGraphics() {
  const [graphics, setGraphics] = useState(readGraphicsSettings);
  useEffect(() => {
    try { localStorage.setItem(graphicsStorageKey, JSON.stringify(graphics)); } catch {}
  }, [graphics]);
  return [graphics, setGraphics] as const;
}

const arrows: Record<string, string> = { ArrowUp: "↑", ArrowLeft: "←", ArrowDown: "↓", ArrowRight: "→" };

export function LessonControls({ graphics, onGraphicsChange, editing = false }: {
  graphics: GraphicsSettings; onGraphicsChange: (settings: GraphicsSettings) => void; editing?: boolean;
}) {
  const { t } = useLanguage();
  const helpId = useId();
  const settingsId = useId();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = shortcutAction(event);
      if ((action !== "guide" && action !== "settings") || document.querySelector(":popover-open, dialog[open]")) return;
      event.preventDefault();
      document.getElementById(action === "guide" ? helpId : settingsId)?.showPopover();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [helpId, settingsId]);
  return <>
    <button type="button" className="controls-info" popoverTarget={helpId} aria-label={t("app.help")} title={`${t("app.help")} (${shortcutLabel("guide")})`}>
      <LineIcon name="alert-circle" size={14} />
    </button>
    <button type="button" className="controls-info" popoverTarget={settingsId} aria-label={t("app.settings")} title={`${t("app.settings")} (${shortcutLabel("settings")})`}>
      <LineIcon name="cog" size={14} />
    </button>
    <PopoverPanel id={settingsId} className="settings-popover" contentClassName="settings-content"
      title={t("app.settings.title")} closeLabel={t("app.settings.close")}>
      <GraphicsControls id={settingsId} graphics={graphics} onChange={onGraphicsChange} />
    </PopoverPanel>
    <PopoverPanel id={helpId} className="controls-guide" contentClassName="guide-content"
      title={t("controls.guide.title")} closeLabel={t("controls.guide.close")}>
      <p>{t(editing ? "lessons.guide.editor" : "lessons.guide.reader")}</p>
      {editing && <p>{t("lessons.dragInstructions")}</p>}
      <p>{t("lessons.guide.cameraFocus")}</p>
      <div className="guide-columns">
        <section aria-label={t("controls.keyboard.label")}><h3>{t("controls.keyboard.label")}</h3>
          {cameraControlGroups.map(group => <div className="guide-key-group" key={group.label}>
            <h4>{t(group.label)}</h4>
            <dl>{group.controls.map(control => <div key={control.key}>
              <dt><kbd>{arrows[control.shortcut] ?? control.shortcut}</kbd></dt><dd>{t(control.label)}</dd>
            </div>)}</dl>
          </div>)}
          <div className="guide-key-group guide-app-shortcuts">
            <h4>{t("shortcuts.app")}</h4>
            <dl>
              <div><dt><kbd>{shortcutLabel("guide")}</kbd></dt><dd>{t("app.help")}</dd></div>
              <div><dt><kbd>{shortcutLabel("settings")}</kbd></dt><dd>{t("app.settings")}</dd></div>
            </dl>
          </div>
        </section>
        <section aria-label={t("controls.mouse.label")}><h3>{t("controls.mouse.label")}</h3>
          <dl className="guide-mouse">
            <div><dt>{t("controls.mouse.dragLeft")}</dt><dd>{t("controls.mouse.rotate")}</dd></div>
            <div><dt>{t("controls.mouse.wheel")}</dt><dd>{t("controls.mouse.zoomAtCursor")}</dd></div>
            <div><dt>{t("controls.mouse.panGesture")}</dt><dd>{t("controls.mouse.pan")}</dd></div>
            {editing && <>
              <div><dt>{t("controls.mouse.holdRight")}</dt><dd>{t("context.hide")}</dd></div>
              <div><dt>{t("controls.mouse.holdLeft")}</dt><dd>{t("context.detach")}</dd></div>
              <div><dt>{t("controls.mouse.selectGesture")}</dt><dd>{t("controls.mouse.selectGroup")}</dd></div>
              <div><dt>{t("controls.mouse.click")}</dt><dd>{t("controls.mouse.showInfo")}</dd></div>
            </>}
          </dl>
        </section>
      </div>
    </PopoverPanel>
  </>;
}
