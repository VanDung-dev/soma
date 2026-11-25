import { useState, type KeyboardEvent } from "react";
import { cameraControlGroups } from "../viewer/camera-controls";
import { useLanguage } from "../i18n";
import {
  appShortcuts, bindingFromEvent, removeShortcut, resetShortcuts, setShortcut, shortcutLabel,
  useShortcutBindings, type AppShortcut, type Shortcut,
} from "../shortcuts";

const appActions = Object.keys(appShortcuts) as AppShortcut[];

export function ShortcutControls() {
  const { t } = useLanguage();
  useShortcutBindings();
  const [recording, setRecording] = useState<Shortcut>();
  const [status, setStatus] = useState<"saved" | "invalid" | "conflict" | "reset" | "removed">();

  const capture = (event: KeyboardEvent<HTMLButtonElement>, action: Shortcut) => {
    if (recording !== action || event.key === "Tab" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") { setRecording(undefined); return; }
    if (event.repeat || ["Control", "Meta", "Alt", "Shift"].includes(event.key)) return;
    const binding = bindingFromEvent(event.nativeEvent);
    const error = binding ? setShortcut(action, binding) : "invalid";
    setStatus(error ?? "saved");
    if (!error) setRecording(undefined);
  };

  const row = (action: Shortcut, label: string) => {
    const key = shortcutLabel(action);
    return <div key={action} className="settings-row shortcut-row">
    <span>{label}</span>
    <button type="button" className="settings-option shortcut-edit" data-shortcut={action} aria-pressed={recording === action}
      aria-label={t("shortcuts.edit", { name: label, key: key ?? t("shortcuts.unassigned") })}
      onClick={() => { setRecording(recording === action ? undefined : action); setStatus(undefined); }}
      onBlur={() => setRecording(current => current === action ? undefined : current)}
      onKeyDown={event => capture(event, action)}>
      {recording === action ? t("shortcuts.recording") : <kbd>{key ?? t("shortcuts.unassigned")}</kbd>}
    </button>
    <button type="button" className="settings-option shortcut-remove" disabled={!key}
      aria-label={t("shortcuts.removeAction", { name: label })}
      onClick={() => { removeShortcut(action); setRecording(undefined); setStatus("removed"); }}>
      {t("shortcuts.remove")}
    </button>
  </div>;
  };

  return <>
    <div className="shortcut-toolbar">
      <p>{t("shortcuts.instructions")}</p>
      <button type="button" className="settings-option" onClick={() => { resetShortcuts(); setRecording(undefined); setStatus("reset"); }}>
        {t("shortcuts.resetAll")}
      </button>
    </div>
    <p className="shortcut-status" role="status">{status ? t(`shortcuts.${status}`) : recording ? t("shortcuts.recording") : ""}</p>
    <div className="shortcut-list">
      <div className="settings-content shortcut-group">
        <h3>{t("shortcuts.app")}</h3>
        {appActions.map(action => row(action, t(appShortcuts[action].label)))}
      </div>
      {cameraControlGroups.map(group => <div className="settings-content shortcut-group" key={group.label}>
        <h3>{t(group.label)}</h3>
        {group.controls.map(control => row(`camera:${control.key}`, t(control.label)))}
      </div>)}
    </div>
  </>;
}
