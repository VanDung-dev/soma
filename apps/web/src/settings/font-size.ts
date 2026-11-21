import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { readSetting, writeSetting } from "./storage";

export function useFontSize() {
  const [fontSize, setFontSizeState] = useState(() => {
    const saved = Number(readSetting("fontSize"));
    return Number.isInteger(saved) && saved >= 6 && saved <= 18 ? String(saved) : "10";
  });
  const [failed, setFailed] = useState(false);
  const pendingZoom = useRef(Promise.resolve());
  const zoom = Number(fontSize) / 10;

  useEffect(() => {
    let stale = false;
    pendingZoom.current = pendingZoom.current.then(async () => {
      if (stale) return;
      if (isTauri()) await getCurrentWebview().setZoom(zoom);
      else {
        document.documentElement.style.zoom = String(zoom);
        document.documentElement.style.width = "";
        document.documentElement.style.setProperty("--scaled-viewport-height", `${100 / zoom}dvh`);
      }
      document.documentElement.style.setProperty("--fixed-ui-zoom", String(1 / zoom));
      if (!stale) setFailed(false);
    }).catch(error => {
      if (!stale) setFailed(true);
      console.error("Could not apply the font size", error);
    });
    return () => { stale = true; };
  }, [zoom]);

  useEffect(() => {
    writeSetting("fontSize", fontSize);
  }, [fontSize]);

  const setFontSize = (value: string) => {
    const next = Number(value);
    if (Number.isInteger(next) && next >= 6 && next <= 18) setFontSizeState(String(next));
  };
  return { fontSize, setFontSize, failed };
}
