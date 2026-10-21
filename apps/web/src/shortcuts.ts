import type { MessageKey } from "./i18n";

export const appShortcuts = {
  settings: { key: "Escape", label: "app.settings", command: false },
  guide: { key: "g", label: "app.help", command: false },
  back: { key: "[", label: "app.back", command: true },
  forward: { key: "]", label: "app.forward", command: true },
  find: { key: "f", label: "search.label", command: false },
  restore: { key: "t", label: "context.restore", command: false },
} satisfies Record<string, { key: string; label: MessageKey; command: boolean }>;

export type AppShortcut = keyof typeof appShortcuts;

export function isMacPlatform(platform = typeof navigator === "undefined" ? "" : navigator.platform) { return /Mac|iPhone|iPad/i.test(platform); }

export function shortcutLabel(action: AppShortcut, mac = isMacPlatform()) {
  const { key, command } = appShortcuts[action];
  return `${command ? mac ? "⌘" : "Ctrl+" : ""}${key === "Escape" ? "Esc" : key.toUpperCase()}`;
}

export function shortcutAction(event: KeyboardEvent, mac = isMacPlatform()): AppShortcut | undefined {
  if (event.defaultPrevented || event.repeat || event.isComposing || event.altKey || event.shiftKey) return;
  const target = event.target as HTMLElement | null;
  const editing = target?.isContentEditable || target?.closest?.("input, textarea, select, [role='textbox']");
  const command = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  for (const action of Object.keys(appShortcuts) as AppShortcut[]) {
    const binding = appShortcuts[action];
    if (binding.command ? !command : event.metaKey || event.ctrlKey) continue;
    if (editing && action !== "settings") continue;
    if (event.key.toLowerCase() === binding.key.toLowerCase()
      || binding.command && event.code === (action === "back" ? "BracketLeft" : "BracketRight")) return action;
  }
}
