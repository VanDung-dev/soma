import { readLesson } from "./contract";
import type { Lesson } from "./contract";
import { lessonJob } from "./archive";
import { validate_lesson_file } from "../content/content.js";
import { getContent } from "../anatomy/core";
import { loadLessonImages, removeLessonImages } from "./images";
import type { LessonImages } from "./images";

export const LESSON_PREFIX = "soma.lesson:";

export function listLessons() {
  return Object.keys(localStorage).filter(key => key.startsWith(LESSON_PREFIX)).map(key => {
    const lesson = readLesson(JSON.parse(localStorage.getItem(key)!), true);
    if (key !== LESSON_PREFIX + lesson.id) throw new Error("Lesson ID does not match its storage key");
    return lesson;
  });
}

export function saveLesson(lesson: Lesson, previous?: Lesson) {
  readLesson(lesson, true);
  const key = LESSON_PREFIX + lesson.id;
  const expected = previous ? JSON.stringify(previous) : null;
  if (localStorage.getItem(key) !== expected) throw new Error("The lesson changed in another tab.");
  localStorage.setItem(key, JSON.stringify(lesson));
}

export function removeLesson(lesson: Lesson) {
  const key = LESSON_PREFIX + lesson.id;
  if (localStorage.getItem(key) !== JSON.stringify(lesson)) throw new Error("The lesson changed in another tab.");
  localStorage.removeItem(key);
  void removeLessonImages(lesson.id, () => localStorage.getItem(key) === null).catch(error => console.error("Lesson image cleanup failed", error));
}

export function newLessonId() {
  return Array.from(crypto.getRandomValues(new Uint32Array(4)), part => part.toString(16).padStart(8, "0")).join("");
}

export async function importLesson(file: File) {
  await getContent();
  validate_lesson_file(file.name, file.size);
  const result = await lessonJob({ operation: "open", name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
  const images: LessonImages = new Map(result.images!.map(([path, bytes, mime]) => [path, new Blob([bytes], { type: mime })]));
  return { lesson: JSON.parse(result.json!) as Lesson, images };
}

export async function exportLesson(lesson: Lesson, language: string) {
  const images = await loadLessonImages(lesson.id);
  const result = await lessonJob({ operation: "export", json: JSON.stringify(lesson), language,
    images: await Promise.all([...images].map(async ([path, blob]): Promise<[string, Uint8Array<ArrayBuffer>]> => [path, new Uint8Array(await blob.arrayBuffer())])) });
  const url = URL.createObjectURL(new Blob([result.bytes!], { type: "application/octet-stream" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = result.name!;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
