import { invoke, isTauri } from "@tauri-apps/api/core";
import { LESSON_STORAGE_PREFIX, readLesson } from "./contract";
import type { Lesson } from "./contract";
import { lessonJob } from "./archive";
import { lesson_draft_paths, restore_lesson_draft, split_lesson_draft, validate_lesson_file } from "../../content/content.js";
import { getCatalog, getContent } from "../../anatomy/core";
import type { Catalog } from "../../anatomy/catalog/types";
import { loadBrowserLessonContent, loadLessonImages, removeLessonImages, retainBrowserLessonContent, retainLessonImages, storeBrowserLessonContent } from "./images";
import type { LessonImages } from "./images";
import { lessonImagePaths } from "./rich-text";
import { lessonModels } from "./targets";

function comparableLesson(lesson: Lesson) {
  return JSON.stringify(lesson, (_key, value: unknown) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : Number(a > b))) : value);
}

function splitStoredLesson(lesson: Lesson, previous?: Lesson) {
  type FileEntry = [string, string];
  const [metadata, tables, retained, html] = split_lesson_draft(JSON.stringify(lesson), previous && JSON.stringify(previous)) as [
    string, FileEntry[], FileEntry[], FileEntry[],
  ];
  const encoder = new TextEncoder();
  if (encoder.encode(metadata).byteLength > 2 * 1024 * 1024) throw new Error("Lesson metadata exceeds 2 MiB");
  const files = [...tables, ...html];
  const paths = new Set(files.map(([path]) => path));
  const resourceBytes = files.reduce((total, [, text]) => total + encoder.encode(text).byteLength, 0);
  const contents = new Map([...html, ...retained]);
  const compacted = new Map<string, string>();
  for (const [path, table] of tables) {
    const oldRows = contents.get(path);
    if (oldRows) compacted.set(path, table);
    contents.set(path, (oldRows ?? "") + table);
  }
  return { metadata, contents, compacted, paths, resourceBytes };
}

async function readStoredLesson(id: string, raw: string) {
  const paths = new Set(lesson_draft_paths(raw));
  if (!paths.size) return readLesson(JSON.parse(raw), true);
  let contents = new Map<string, string>();
  try { contents = await loadBrowserLessonContent(id, paths); }
  catch (error) { console.error("Saved lesson resources could not be opened", id, error); }
  return readLesson(JSON.parse(restore_lesson_draft(raw, [...contents])), true);
}

export async function listLessons() {
  const lessons: Lesson[] = [];
  const invalidKeys: string[] = [];
  if (isTauri()) {
    for (const [key, raw] of await invoke<[string, string | null][]>("list_saved_lessons")) {
      if (raw === null) invalidKeys.push(key);
      else lessons.push(readLesson(JSON.parse(raw), true));
    }
    return { lessons, invalidKeys };
  }
  const keys = Object.keys(localStorage).filter(key => key.startsWith(LESSON_STORAGE_PREFIX));
  for (const key of keys) {
    try {
      const id = key.slice(LESSON_STORAGE_PREFIX.length);
      const lesson = await withLessonLock(id, async () => {
        const raw = localStorage.getItem(key);
        return raw === null ? undefined : readStoredLesson(id, raw);
      });
      if (!lesson) continue;
      if (key !== LESSON_STORAGE_PREFIX + lesson.id) throw new Error("Lesson ID does not match its storage key");
      lessons.push(lesson);
    } catch {
      invalidKeys.push(key);
    }
  }
  return { lessons, invalidKeys };
}

export async function saveLesson(lesson: Lesson, previous?: Lesson) {
  readLesson(lesson, true);
  if (isTauri()) return invoke<void>("save_lesson", { id: lesson.id, json: JSON.stringify(lesson), expected: previous ? JSON.stringify(previous) : null });
  return withLessonLock(lesson.id, async () => {
    const key = LESSON_STORAGE_PREFIX + lesson.id;
    const current = localStorage.getItem(key);
    if (current === null ? previous !== undefined : !previous || comparableLesson(await readStoredLesson(lesson.id, current)) !== comparableLesson(previous)) {
      throw new Error("The lesson changed in another tab.");
    }
    const { metadata, contents, compacted, paths, resourceBytes } = splitStoredLesson(lesson, previous);
    const imagePaths = lessonImagePaths(lesson);
    const images = await loadLessonImages(lesson.id, imagePaths);
    const imageBytes = [...images].filter(([path]) => imagePaths.has(path)).reduce((total, [, blob]) => total + blob.size, 0);
    if (resourceBytes + imageBytes > 60 * 1024 * 1024) throw new Error("Lesson resources exceed 60 MiB");
    await storeBrowserLessonContent(lesson.id, contents);
    localStorage.setItem(key, metadata);
    try {
      if (compacted.size) await storeBrowserLessonContent(lesson.id, compacted);
      await retainBrowserLessonContent(lesson.id, paths);
    }
    catch (error) { console.error("Lesson resource cleanup failed", error); }
    try { await retainLessonImages(lesson.id, imagePaths, metadata); }
    catch (error) { console.error("Lesson image cleanup failed", error); }
  });
}

function withLessonLock<T>(id: string, action: () => Promise<T>) {
  return navigator.locks ? navigator.locks.request(LESSON_STORAGE_PREFIX + id, action) : action();
}

export async function removeLesson(lesson: Lesson) {
  if (isTauri()) return invoke<void>("remove_lesson", { id: lesson.id, expected: JSON.stringify(lesson) });
  return withLessonLock(lesson.id, async () => {
    const key = LESSON_STORAGE_PREFIX + lesson.id;
    const current = localStorage.getItem(key);
    if (!current || comparableLesson(await readStoredLesson(lesson.id, current)) !== comparableLesson(lesson)) throw new Error("The lesson changed in another tab.");
    localStorage.removeItem(key);
    await retainBrowserLessonContent(lesson.id, new Set(), () => localStorage.getItem(key) === null)
      .catch(error => console.error("Lesson resource cleanup failed", error));
    await removeLessonImages(lesson.id, () => localStorage.getItem(key) === null).catch(error => console.error("Lesson image cleanup failed", error));
  });
}

export function newLessonId() {
  return Array.from(crypto.getRandomValues(new Uint32Array(4)), part => part.toString(16).padStart(8, "0")).join("");
}

export async function importLesson(file: File) {
  if (!/\.lesson\.br$/i.test(file.name)) throw new Error("Invalid .lesson.br file");
  await getContent();
  validate_lesson_file(file.name, file.size);
  const result = await lessonJob({ operation: "open", name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
  const images: LessonImages = new Map(result.images!.map(([path, bytes, mime]) => [path, new Blob([bytes], { type: mime })]));
  const lesson = JSON.parse(result.json!) as Lesson;
  if (result.preloadModelIds?.length) lesson.preloadModelIds = result.preloadModelIds;
  return { lesson, images };
}

export async function exportLesson(lesson: Lesson, language: string, catalog?: Catalog) {
  const images = await loadLessonImages(lesson.id, lessonImagePaths(lesson));
  const ownedCatalog = catalog ? undefined : await getCatalog();
  let modelIds: string[];
  try { modelIds = lessonModels(catalog ?? ownedCatalog!, lesson); }
  finally { ownedCatalog?.free(); }
  const result = await lessonJob({ operation: "export", json: JSON.stringify(lesson), language, modelIds,
    images: await Promise.all([...images].map(async ([path, blob]): Promise<[string, Uint8Array<ArrayBuffer>]> => [path, new Uint8Array(await blob.arrayBuffer())])) });
  const url = URL.createObjectURL(new Blob([result.bytes!], { type: "application/octet-stream" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = result.name!;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
