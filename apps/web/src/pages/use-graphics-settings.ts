import { createContext, useContext, useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { readGraphicsSettings, type GraphicsSettings } from "../anatomy/viewer/graphics";
import { writeSetting } from "../settings/storage";

export const GraphicsSettingsContext = createContext<readonly [GraphicsSettings, Dispatch<SetStateAction<GraphicsSettings>>] | null>(null);

export function useGraphicsSettings() {
  const shared = useContext(GraphicsSettingsContext);
  const [graphics, setGraphics] = useState(readGraphicsSettings);
  useEffect(() => {
    if (shared) return;
    writeSetting("graphics", graphics);
  }, [graphics, shared]);
  return shared ?? [graphics, setGraphics] as const;
}
