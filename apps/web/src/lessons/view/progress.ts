import { useMemo, useRef, useState } from "react";
import { initialize_lesson_progress, lesson_playback, update_lesson_progress } from "../../content/content.js";
import type { LessonStep } from "../shared/contract";
import type { LessonReaderMode } from "../shared/sections";

type ProgressAction = { kind: "jump"; stepId?: string } | { kind: "finish" } | { kind: "read"; stepId: string }
  | { kind: "answer"; stepId: string; questionId: string; answerId: string; choiceId: string };

type Playback = {
  index: number;
  complete: boolean;
  read: boolean;
  reading: boolean;
  readingDurationMs: number;
  awaitingAnswers: boolean;
  nextLocked: boolean;
  questionsOnly: boolean;
  showQuestions: boolean;
  correctQuestions: string[];
  rows: { read: boolean; locked: boolean }[];
};

function storedProgress(key: string) {
  try { return localStorage.getItem(key) ?? "null"; }
  catch { return "null"; }
}

export function useLessonProgress(lessonId: string, mode: LessonReaderMode, steps: readonly LessonStep[],
  issues: ReadonlyMap<string, unknown>, initialStepId?: string) {
  const key = `soma.lesson-progress-v1:${lessonId}`;
  const preview = mode === "preview";
  const [progress, setProgress] = useState(() => initialize_lesson_progress(storedProgress(key), preview, initialStepId));
  const [unsaved, setUnsaved] = useState(false);
  const latest = useRef(progress);
  const rules = useMemo(() => steps.map(({ id, mode, questionRef, questions = [] }) => ({
    id, mode, questionRef, questions: questions.map(({ id, answerId }) => ({ id, answerId })),
  })), [steps]);
  const invalid = useMemo(() => [...issues.keys()], [issues]);
  const playback = useMemo(() => lesson_playback(progress, rules, invalid, preview) as Playback, [progress, rules, invalid, preview]);

  function update(action: ProgressAction) {
    const next = update_lesson_progress(latest.current, preview ? undefined : storedProgress(key), action);
    if (next === undefined) return false;
    latest.current = next;
    setProgress(next);
    if (!preview) {
      try { localStorage.setItem(key, next); setUnsaved(false); }
      catch { setUnsaved(true); }
    }
    return true;
  }

  return [playback, update, unsaved] as const;
}
