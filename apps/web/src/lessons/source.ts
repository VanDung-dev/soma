import { readLesson } from "./contract";
import type { Lesson } from "./contract";
import { packLesson, unpackLesson } from "./jsoma";

const prefix = "soma.lesson:";

export function listLessons() {
  return Object.keys(localStorage).filter(key => key.startsWith(prefix)).map(key => {
    const lesson = readLesson(JSON.parse(localStorage.getItem(key)!), true);
    if (key !== prefix + lesson.id) throw new Error("Lesson ID does not match its storage key");
    return lesson;
  });
}

export function saveLesson(lesson: Lesson, previous?: Lesson) {
  readLesson(lesson, true);
  const key = prefix + lesson.id;
  const expected = previous ? JSON.stringify(previous) : null;
  if (localStorage.getItem(key) !== expected) throw new Error("The lesson changed in another tab.");
  localStorage.setItem(key, JSON.stringify(lesson));
}

export function removeLesson(lesson: Lesson) {
  const key = prefix + lesson.id;
  if (localStorage.getItem(key) !== JSON.stringify(lesson)) throw new Error("The lesson changed in another tab.");
  localStorage.removeItem(key);
}

export function newLessonId() {
  return Array.from(crypto.getRandomValues(new Uint32Array(4)), part => part.toString(16).padStart(8, "0")).join("");
}

export async function importLesson(file: File) {
  if (file.size > 512 * 1024) throw new Error("Invalid JSoma archive size");
  return readLesson(unpackLesson(new Uint8Array(await file.arrayBuffer())));
}

export function exportLesson(lesson: Lesson) {
  const bytes = packLesson(lesson);
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/zip" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${lesson.id}.jsoma`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
