import { useSyncExternalStore } from "react";
import { cameraControls } from "./anatomy/camera-controls";
import type { MessageKey } from "./i18n";
import { readSetting, writeSetting } from "./settings/storage";

export const appShortcuts = {
  settings: { key: ",", label: "app.settings", command: true },
  back: { key: "[", label: "app.back", command: true },
  forward: { key: "]", label: "app.forward", command: true },
  catalog: { key: "s", label: "catalog.heading", command: true, shift: true },
  information: { key: ".", label: "information.panel.label", command: true, shift: true },
  restore: { key: "t", label: "context.restore", command: false },
} satisfies Record<string, { key: string; label: MessageKey; command: boolean; shift?: boolean }>;

export type AppShortcut = keyof typeof appShortcuts;
type CameraShortcut = `camera:${string}`;
export type Shortcut = AppShortcut | CameraShortcut;
export type ShortcutBinding = { key: string; command: boolean; shift?: boolean };
type Overrides = Partial<Record<Shortcut, ShortcutBinding | null>>;

const appActions = Object.keys(appShortcuts) as AppShortcut[];
const actions: Shortcut[] = [...appActions, ...cameraControls.map(({ key }): CameraShortcut => `camera:${key}`)];
const physicalKeys: Record<string, string> = { Comma: ",", BracketLeft: "[", BracketRight: "]", Period: "." };
const arrowLabels: Record<string, string> = { arrowup: "↑", arrowleft: "←", arrowdown: "↓", arrowright: "→" };
const editingKeys = new Set(["a", "c", "f", "v", "x", "y", "z"]);
const listeners = new Set<() => void>();

function sameBinding(a: ShortcutBinding | undefined, b: ShortcutBinding | undefined) {
  return !!a && !!b && a.key === b.key && a.command === b.command && !!a.shift === !!b.shift;
}

function validBinding(value: unknown): value is ShortcutBinding {
  if (typeof value !== "object" || !value) return false;
  const { key, command, shift } = value as ShortcutBinding;
  return typeof key === "string" && key === key.toLowerCase()
    && (Object.hasOwn(arrowLabels, key) || (Array.from(key).length === 1 && !!key.trim()))
    && typeof command === "boolean" && (shift === undefined || typeof shift === "boolean")
    && !(command && editingKeys.has(key) && (!shift || key === "z"));
}

function bindingFor(action: Shortcut, values = overrides): ShortcutBinding | undefined {
  if (Object.hasOwn(values, action)) return values[action] ?? undefined;
  return action.startsWith("camera:") ? { key: action.slice(7), command: false } : appShortcuts[action as AppShortcut];
}

function readOverrides(): Overrides {
  try {
    const stored = (readSetting("shortcuts") ?? {}) as Overrides;
    const values: Overrides = {};
    for (const action of actions) {
      if (stored[action] === null) values[action] = null;
      else if (validBinding(stored[action])) values[action] = stored[action];
    }
    if (actions.some((action, index) => actions.slice(0, index).some(other => sameBinding(bindingFor(action, values), bindingFor(other, values))))) return {};
    return values;
  } catch { return {}; }
}

let overrides = readOverrides();
export function initializeShortcuts() {
  overrides = readOverrides();
}
const emptyOverrides: Overrides = {};
const snapshot = () => overrides;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export function useShortcutBindings() {
  return useSyncExternalStore(subscribe, snapshot, () => emptyOverrides);
}

function store(values: Overrides) {
  overrides = values;
  writeSetting("shortcuts", values);
  listeners.forEach(listener => listener());
}

export function setShortcut(action: Shortcut, binding: ShortcutBinding): "invalid" | "conflict" | undefined {
  if (!validBinding(binding)) return "invalid";
  if (actions.some(other => other !== action && sameBinding(bindingFor(other), binding))) return "conflict";
  store({ ...overrides, [action]: binding });
}

export function removeShortcut(action: Shortcut) {
  store({ ...overrides, [action]: null });
}

export function resetShortcuts() {
  store({});
}

export function isMacPlatform(platform = typeof navigator === "undefined" ? "" : navigator.platform) { return /Mac|iPhone|iPad/i.test(platform); }

export function shortcutLabel(action: Shortcut, mac = isMacPlatform()) {
  const binding = bindingFor(action);
  if (!binding) return;
  const { key, command, shift } = binding;
  return `${shift ? mac ? "⇧" : "Shift+" : ""}${command ? mac ? "⌘" : "Ctrl+" : ""}${arrowLabels[key] ?? key.toUpperCase()}`;
}

export function shortcutAriaLabel(action: AppShortcut, mac = isMacPlatform()) {
  const binding = bindingFor(action);
  if (!binding) return;
  const { key, command, shift } = binding;
  return `${command ? mac ? "Meta+" : "Control+" : ""}${shift ? "Shift+" : ""}${key}`;
}

export function bindingFromEvent(event: KeyboardEvent, mac = isMacPlatform()): ShortcutBinding | undefined {
  const command = !!(mac ? event.metaKey : event.ctrlKey);
  if (event.altKey || (mac ? event.ctrlKey : event.metaKey)) return;
  return { key: physicalKeys[event.code] ?? event.key.toLowerCase(), command, shift: !!event.shiftKey };
}

export function frameShortcuts() {
  return appActions.flatMap(action => {
    const binding = bindingFor(action);
    return binding ? [{ ...binding, editing: action === "settings" }] : [];
  });
}

export function shortcutAction(event: KeyboardEvent, mac = isMacPlatform()): AppShortcut | undefined {
  if (event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229) return;
  const binding = bindingFromEvent(event, mac);
  if (!binding) return;
  const target = event.target as HTMLElement | null;
  const editing = target?.isContentEditable || target?.closest?.("input, textarea, select, [role='textbox']");
  return appActions.find(action => (!editing || action === "settings" && binding.command) && sameBinding(bindingFor(action), binding));
}

export function cameraShortcutAction(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
  const binding = bindingFromEvent(event);
  if (binding) return cameraControls.find(({ key }) => sameBinding(bindingFor(`camera:${key}`), binding));
}
