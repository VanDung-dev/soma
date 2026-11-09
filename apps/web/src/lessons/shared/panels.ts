import { useState } from "react";

export function useLessonPanel(name: "editorOutline" | "readerOutline", initial: boolean) {
  const key = `soma.lessons.panel:${name}`;
  const [open, setOpen] = useState(() => {
    try {
      const value = localStorage.getItem(key);
      return value === "true" ? true : value === "false" ? false : initial;
    } catch { return initial; }
  });
  function change(value = !open) {
    setOpen(value);
    try { localStorage.setItem(key, String(value)); } catch {}
  }
  return [open, change] as const;
}
