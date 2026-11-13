import { invoke, isTauri } from "@tauri-apps/api/core";
import { readLesson } from "./contract";
import type { Lesson } from "./contract";
import { lessonJob } from "./archive";
import { validate_lesson_file } from "../../content/content.js";
import { getContent } from "../../anatomy/core";
import { loadBrowserLessonContent, loadBrowserLessonImages, loadLessonImages, removeLessonImages, retainBrowserLessonContent, retainLessonImages, storeBrowserLessonContent, storeLessonImages } from "./images";
import type { LessonImages } from "./images";
import { lessonImagePaths } from "./rich-text";

const LESSON_PREFIX = "soma.lesson:";
const CONTENT_REFERENCE = /^lesson-content:([a-f0-9]{64})$/;

function contentPaths(value: unknown, paths = new Set<string>()) {
  if (Array.isArray(value)) value.forEach(item => contentPaths(item, paths));
  else if (value && typeof value === "object") {
    const fields = value as Record<string, unknown>;
    if (Array.isArray(fields.html)) {
      for (const locale of fields.html) {
        if (locale !== "vi" && locale !== "en") continue;
        const hash = typeof fields[locale] === "string" ? CONTENT_REFERENCE.exec(fields[locale] as string)?.[1] : undefined;
        if (hash) paths.add(`content/${hash}.html`);
      }
    }
    Object.values(fields).forEach(item => contentPaths(item, paths));
  }
  return paths;
}

function transformLessonContent(value: unknown, transform: (html: string) => string | undefined) {
  if (Array.isArray(value)) value.forEach(item => transformLessonContent(item, transform));
  else if (value && typeof value === "object") {
    const fields = value as Record<string, unknown>;
    if (Array.isArray(fields.html)) {
      for (const locale of fields.html) {
        if (locale !== "vi" && locale !== "en" || typeof fields[locale] !== "string") continue;
        const replacement = transform(fields[locale] as string);
        if (replacement !== undefined) fields[locale] = replacement;
      }
    }
    Object.values(fields).forEach(item => transformLessonContent(item, transform));
  }
}

async function contentHash(html: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(html));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function externalizeLessonContent(lesson: Lesson) {
  const stored = JSON.parse(JSON.stringify(lesson)) as Lesson;
  const contents = new Map<string, string>();
  const fields: { object: Record<string, unknown>; locale: "vi" | "en"; html: string }[] = [];
  const collect = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (Array.isArray(record.html)) for (const locale of record.html) {
        if ((locale === "vi" || locale === "en") && typeof record[locale] === "string" && record[locale]) {
          fields.push({ object: record, locale, html: record[locale] as string });
        }
      }
      Object.values(record).forEach(collect);
    }
  };
  collect(stored);
  for (const field of fields) {
    const hash = await contentHash(field.html);
    contents.set(`content/${hash}.html`, field.html);
    field.object[field.locale] = `lesson-content:${hash}`;
  }
  const sizes = [...contents.values()].map(html => new TextEncoder().encode(html).byteLength);
  if (contents.size > 2048 || sizes.reduce((total, size) => total + size, 0) > 60 * 1024 * 1024
    || sizes.some(size => size > 2 * 1024 * 1024)) {
    throw new Error("Lesson text content limit exceeded");
  }
  if (new TextEncoder().encode(JSON.stringify(stored)).byteLength > 2 * 1024 * 1024) {
    throw new Error("Lesson metadata exceeds 2 MiB");
  }
  return { stored, contents, contentBytes: sizes.reduce((total, size) => total + size, 0) };
}

async function readStoredLesson(id: string, raw: string) {
  const stored = JSON.parse(raw) as Lesson;
  const paths = contentPaths(stored);
  if (!paths.size) return readLesson(stored, true);
  let contents = new Map<string, string>();
  try { contents = await loadBrowserLessonContent(id, paths); }
  catch (error) { console.error("Saved lesson text storage could not be opened", id, error); }
  for (const [path, html] of contents) {
    if (await contentHash(html) !== path.slice("content/".length, -".html".length)) contents.delete(path);
  }
  const missing: string[] = [];
  transformLessonContent(stored, value => {
    const hash = CONTENT_REFERENCE.exec(value)?.[1];
    if (!hash) {
      if (value.startsWith("lesson-content:")) { missing.push(value); return "[Missing lesson text content]"; }
      return undefined;
    }
    const path = `content/${hash}.html`;
    const html = contents.get(path);
    if (!html) { missing.push(path); return "[Missing lesson text content]"; }
    return html;
  });
  if (missing.length) console.error("Saved lesson text could not be read", id, missing);
  return readLesson(stored, true);
}

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
      const lesson = await readStoredLesson(key.slice(LESSON_PREFIX.length), raw);
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
  if (isTauri()) return invoke<void>("save_lesson", { id: lesson.id, json: JSON.stringify(lesson), expected });
  const key = LESSON_PREFIX + lesson.id;
  const current = localStorage.getItem(key);
  if (current === null ? expected !== null : JSON.stringify(await readStoredLesson(lesson.id, current)) !== expected) {
    throw new Error("The lesson changed in another tab.");
  }
  const { stored, contents, contentBytes } = await externalizeLessonContent(lesson);
  const imagePaths = lessonImagePaths(lesson);
  const images = await loadLessonImages(lesson.id, imagePaths);
  const imageBytes = [...images].filter(([path]) => imagePaths.has(path)).reduce((total, [, blob]) => total + blob.size, 0);
  if (contentBytes + imageBytes > 60 * 1024 * 1024) throw new Error("Lesson resources exceed 60 MiB");
  await storeBrowserLessonContent(lesson.id, contents);
  localStorage.setItem(key, JSON.stringify(stored));
  try { await retainBrowserLessonContent(lesson.id, contentPaths(stored)); }
  catch (error) { console.error("Lesson text cleanup failed", error); }
  try { await retainLessonImages(lesson.id, imagePaths, lesson); }
  catch (error) { console.error("Lesson image cleanup failed", error); }
}

export async function removeLesson(lesson: Lesson) {
  const expected = JSON.stringify(lesson);
  if (isTauri()) return invoke<void>("remove_lesson", { id: lesson.id, expected });
  const key = LESSON_PREFIX + lesson.id;
  const current = localStorage.getItem(key);
  if (!current || JSON.stringify(await readStoredLesson(lesson.id, current)) !== expected) throw new Error("The lesson changed in another tab.");
  localStorage.removeItem(key);
  void retainBrowserLessonContent(lesson.id, new Set(), () => localStorage.getItem(key) === null)
    .catch(error => console.error("Lesson text cleanup failed", error));
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
