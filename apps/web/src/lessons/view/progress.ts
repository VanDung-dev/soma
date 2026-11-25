import { useRef, useState } from "react";
import type { LessonReaderMode } from "../shared/sections";

type LessonProgress = {
  position?: string | null;
  read: string[];
  answers: Record<string, string>;
};

function loadProgress(key: string): LessonProgress {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? "null") as Partial<LessonProgress> | null;
    return {
      position: typeof saved?.position === "string" || saved?.position === null ? saved.position : undefined,
      read: Array.isArray(saved?.read) ? saved.read.filter(id => typeof id === "string") : [],
      answers: Object.fromEntries(Object.entries(saved?.answers ?? {}).filter(([, choice]) => typeof choice === "string")),
    };
  } catch { return { read: [], answers: {} }; }
}

export function useLessonProgress(lessonId: string, mode: LessonReaderMode, initialStepId?: string) {
  const key = `soma.lesson-progress-v1:${lessonId}`;
  const recording = mode === "view";
  const [progress, setProgress] = useState<LessonProgress>(() => {
    const saved = loadProgress(key);
    return recording ? saved : { position: initialStepId, read: saved.read, answers: {} };
  });
  const [unsaved, setUnsaved] = useState(false);
  const latest = useRef(progress);

  function update(change: (current: LessonProgress) => LessonProgress) {
    let current = latest.current;
    if (recording) {
      const stored = loadProgress(key);
      current = { ...current, read: [...new Set([...stored.read, ...current.read])], answers: { ...current.answers, ...stored.answers } };
    }
    const next = change(current);
    latest.current = next;
    setProgress(next);
    if (recording) {
      try { localStorage.setItem(key, JSON.stringify(next)); setUnsaved(false); }
      catch { setUnsaved(true); }
    }
  }

  return [progress, update, unsaved] as const;
}
