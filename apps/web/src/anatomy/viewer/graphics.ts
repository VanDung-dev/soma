export type GraphicsQuality = "low" | "high";
export type GraphicsSettings = {
  shadowQuality: "off" | "low" | "high";
  lightingQuality: GraphicsQuality;
  modelQuality: GraphicsQuality;
  frameRate: 30 | 60;
  grid: boolean;
  showFps: boolean;
};

export const graphicsStorageKey = "human-atlas-graphics";
export const defaultGraphics: GraphicsSettings = {
  shadowQuality: "off", lightingQuality: "high", modelQuality: "high", frameRate: 60, grid: true, showFps: false,
};
export const qualityLevels = { low: 0, high: 2 } as const;
export const renderScales = { low: 0.5, high: 1 } as const;

function readQuality(value: unknown): GraphicsQuality {
  return value === "low" ? "low" : "high";
}

export function readGraphicsSettings(): GraphicsSettings {
  try {
    const value = JSON.parse(window.localStorage.getItem(graphicsStorageKey) ?? "null");
    const legacyShadow = value?.quality === "balanced" ? "low" : value?.quality === "high" ? "high" : "off";
    const shadowQuality = value?.shadowQuality ?? legacyShadow;
    return {
      shadowQuality: shadowQuality === "low" || shadowQuality === "high" ? shadowQuality : "off",
      lightingQuality: readQuality(value?.lightingQuality),
      modelQuality: readQuality(value?.modelQuality ?? value?.quality),
      frameRate: value?.frameRate === 30 ? 30 : 60,
      grid: typeof value?.grid === "boolean" ? value.grid : true,
      showFps: typeof value?.showFps === "boolean" ? value.showFps : false,
    };
  } catch { return { ...defaultGraphics }; }
}
