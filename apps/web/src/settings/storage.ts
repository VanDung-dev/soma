import { invoke, isTauri } from "@tauri-apps/api/core";

const settingsKeys = {
  language: "human-atlas-language",
  theme: "human-atlas-theme",
  fontSize: "soma-font-size",
  graphics: "human-atlas-graphics",
  shortcuts: "soma-shortcuts",
  camera: "soma-camera-device",
} as const;

type Setting = keyof typeof settingsKeys;
type Values = Partial<Record<Setting, unknown>>;

let desktopValues: Values | undefined;
let pendingWrite = Promise.resolve();

function readBrowserSetting(name: Setting): unknown {
  try {
    const value = window.localStorage.getItem(settingsKeys[name]);
    return value !== null && (name === "graphics" || name === "shortcuts") ? JSON.parse(value) : value;
  } catch { return undefined; }
}

export async function loadSettings() {
  if (!isTauri()) return;
  const legacy = Object.fromEntries((Object.keys(settingsKeys) as Setting[]).flatMap(name => {
    const value = readBrowserSetting(name);
    return value == null ? [] : [[name, value]];
  }));
  const initialValues = { camera: "", shortcuts: {}, ...legacy };
  try {
    desktopValues = await invoke<Values>("load_settings", { legacy: initialValues });
  } catch (error) {
    desktopValues = initialValues;
    console.error("Could not load desktop settings", error);
  }
}

export function readSetting(name: Setting): unknown {
  return desktopValues ? desktopValues[name] : readBrowserSetting(name);
}

export function writeSetting(name: Setting, value: string | object) {
  if (desktopValues) {
    if (JSON.stringify(desktopValues[name]) === JSON.stringify(value)) return;
    desktopValues[name] = value;
    pendingWrite = pendingWrite.then(() => invoke<void>("save_setting", { name, value })).catch(error => {
      console.error("Could not save desktop setting", name, error);
    });
    return;
  }
  try { window.localStorage.setItem(settingsKeys[name], typeof value === "string" ? value : JSON.stringify(value)); } catch {}
}
