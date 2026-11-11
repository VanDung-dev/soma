import { invoke, isTauri } from "@tauri-apps/api/core";
import { readLesson } from "./contract";
import type { Lesson } from "./contract";
import { lessonJob } from "./archive";
import { validate_lesson_file } from "../../content/content.js";
import { getContent } from "../../anatomy/core";
import { loadBrowserLessonImages, loadLessonImages, removeLessonImages, storeLessonImages } from "./images";
import type { LessonImages } from "./images";
import { lessonImagePaths } from "./rich-text";

const LESSON_PREFIX = "soma.lesson:";

export async function listLessons() {
  const lessons: Lesson[] = [];
  const invalidKeys: string[] = [];
  const desktop = isTauri();
  if (desktop) {
    for (const [key, raw] of await invoke<[string, string | null][]>("list_saved_lessons")) {
      if (raw === null) invalidKeys.push(key);
      else lessons.push(readLesson(JSON.parse(raw), true));
    }
  }
  let keys: string[];
  try {
    keys = Object.keys(localStorage).filter(key => key.startsWith(LESSON_PREFIX));
  } catch (error) {
    if (!desktop) throw error;
    return { lessons, invalidKeys };
  }
  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) continue;
      const lesson = readLesson(JSON.parse(raw), true);
      if (key !== LESSON_PREFIX + lesson.id) throw new Error("Lesson ID does not match its storage key");
      if (desktop) {
        const existing = lessons.find(item => item.id === lesson.id);
        if (existing && JSON.stringify(existing) !== JSON.stringify(lesson)) {
          throw new Error("A different lesson with this ID already exists on disk.");
        }
        if (!existing) {
          const paths = lessonImagePaths(lesson);
          if (paths.size) {
            const images = await loadBrowserLessonImages(lesson.id);
            for (const path of images.keys()) if (!paths.has(path)) images.delete(path);
            await storeLessonImages(lesson.id, images);
          }
          await saveLesson(lesson);
          lessons.push(lesson);
        }
        if (localStorage.getItem(key) === raw) localStorage.removeItem(key);
      } else {
        lessons.push(lesson);
      }
    } catch {
      invalidKeys.push(key);
    }
  }
  return { lessons, invalidKeys };
}

export async function saveLesson(lesson: Lesson, previous?: Lesson) {
  readLesson(lesson, true);
  const expected = previous ? JSON.stringify(previous) : null;
  const json = JSON.stringify(lesson);
  if (isTauri()) return invoke<void>("save_lesson", { id: lesson.id, json, expected });
  const key = LESSON_PREFIX + lesson.id;
  if (localStorage.getItem(key) !== expected) throw new Error("The lesson changed in another tab.");
  localStorage.setItem(key, json);
}

export async function removeLesson(lesson: Lesson) {
  const expected = JSON.stringify(lesson);
  if (isTauri()) return invoke<void>("remove_lesson", { id: lesson.id, expected });
  const key = LESSON_PREFIX + lesson.id;
  if (localStorage.getItem(key) !== expected) throw new Error("The lesson changed in another tab.");
  localStorage.removeItem(key);
  void removeLessonImages(lesson.id, () => localStorage.getItem(key) === null).catch(error => console.error("Lesson image cleanup failed", error));
}

export function newLessonId() {
  return Array.from(crypto.getRandomValues(new Uint32Array(4)), part => part.toString(16).padStart(8, "0")).join("");
}

export async function importLesson(file: File) {
  if (!/\.(lesson|soma)\.br$/i.test(file.name)) throw new Error("Invalid .lesson.br file");
  await getContent();
  validate_lesson_file(file.name, file.size);
  const result = await lessonJob({ operation: "open", name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
  const images: LessonImages = new Map(result.images!.map(([path, bytes, mime]) => [path, new Blob([bytes], { type: mime })]));
  return { lesson: JSON.parse(result.json!) as Lesson, images };
}

export async function exportLesson(lesson: Lesson, language: string) {
  const images = await loadLessonImages(lesson.id, lessonImagePaths(lesson));
  const result = await lessonJob({ operation: "export", json: JSON.stringify(lesson), language,
    images: await Promise.all([...images].map(async ([path, blob]): Promise<[string, Uint8Array<ArrayBuffer>]> => [path, new Uint8Array(await blob.arrayBuffer())])) });
  const url = URL.createObjectURL(new Blob([result.bytes!], { type: "application/octet-stream" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = result.name!;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
