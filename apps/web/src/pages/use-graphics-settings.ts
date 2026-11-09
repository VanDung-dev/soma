import { useEffect, useState } from "react";
import { graphicsStorageKey, readGraphicsSettings } from "../anatomy/viewer/graphics";

export function useGraphicsSettings() {
  const [graphics, setGraphics] = useState(readGraphicsSettings);
  useEffect(() => {
    try { window.localStorage.setItem(graphicsStorageKey, JSON.stringify(graphics)); } catch {}
  }, [graphics]);
  return [graphics, setGraphics] as const;
}
