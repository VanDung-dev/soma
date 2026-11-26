import { invoke, isTauri } from "@tauri-apps/api/core";
import * as content from "../../content/content.js";
import { openIndexedDatabase, transactionComplete } from "../../indexed-db";
import { lessonJob } from "./archive";
import type { LessonImageStage } from "./archive";
import { LESSON_STORAGE_PREFIX } from "./contract";
import type { Lesson } from "./contract";
import { lessonImagePaths } from "./rich-text";

export type LessonImages = Map<string, Blob>;

type LessonStore = "images" | "content";

function database() {
  return openIndexedDatabase("soma-lesson-images-v1", 1, db => {
    if (!db.objectStoreNames.contains("images")) db.createObjectStore("images");
    if (!db.objectStoreNames.contains("content")) db.createObjectStore("content");
  }, { closeOnVersionChange: true, blockedMessage: "Lesson image storage is blocked" });
}

async function withLessonStore(storeName: LessonStore, mode: IDBTransactionMode, useStore: (store: IDBObjectStore) => void) {
  const db = await database();
  try {
    const transaction = db.transaction(storeName, mode);
    useStore(transaction.objectStore(storeName));
    await transactionComplete(transaction);
  } finally { db.close(); }
}

function scanLessonRecords(id: string, storeName: LessonStore, mode: IDBTransactionMode,
  visit: (cursor: IDBCursorWithValue) => boolean | void) {
  return withLessonStore(storeName, mode, store => {
    const request = store.openCursor(IDBKeyRange.bound([id, ""], [id, "\uffff"]));
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor && visit(cursor) !== false) cursor.continue();
    };
  });
}

function putLessonRecords(id: string, storeName: LessonStore, records: ReadonlyMap<string, string | Blob>) {
  return withLessonStore(storeName, "readwrite", store => {
    for (const [path, value] of records) store.put(value, [id, path]);
  });
}

function removeLessonRecords(id: string, storeName: LessonStore, canRemove: () => boolean, keep?: ReadonlySet<string>) {
  return scanLessonRecords(id, storeName, "readwrite", cursor => {
    if (!canRemove()) return false;
    if (!keep || !keep.has((cursor.key as string[])[1]!)) cursor.delete();
  });
}

export async function loadLessonImages(id: string, paths?: ReadonlySet<string>) {
  if (isTauri()) {
    const images: LessonImages = new Map();
    for (const path of paths ?? await invoke<string[]>("list_lesson_images", { id })) {
      const blob = await loadLessonImage(id, path);
      if (blob) images.set(path, blob);
    }
    return images;
  }
  return loadBrowserLessonImages(id);
}

export async function loadBrowserLessonImages(id: string) {
  const images: LessonImages = new Map();
  await scanLessonRecords(id, "images", "readonly", cursor => {
    images.set((cursor.key as string[])[1]!, cursor.value as Blob);
  });
  return images;
}

export async function loadBrowserLessonContent(id: string, paths: ReadonlySet<string>) {
  const db = await database();
  try {
    return await new Promise<Map<string, string>>((resolve, reject) => {
      const transaction = db.transaction("content");
      const store = transaction.objectStore("content");
      const contents = new Map<string, string>();
      let remaining = paths.size;
      if (!remaining) { resolve(contents); return; }
      for (const path of paths) {
        const request = store.get([id, path]);
        request.onsuccess = () => {
          if (typeof request.result === "string") contents.set(path, request.result);
          if (!--remaining) resolve(contents);
        };
        request.onerror = () => reject(request.error);
      }
      transaction.onabort = transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

export function storeBrowserLessonContent(id: string, contents: ReadonlyMap<string, string>) {
  return putLessonRecords(id, "content", contents);
}

export function retainBrowserLessonContent(id: string, paths: ReadonlySet<string>, canRemove: () => boolean = () => true) {
  return removeLessonRecords(id, "content", canRemove, paths);
}

export async function loadLessonImage(id: string, path: string) {
  if (isTauri()) {
    const bytes = await invoke<ArrayBuffer | number[]>("get_lesson_image", { id, path });
    const data = new Uint8Array(bytes);
    const type = path.endsWith(".jpg") ? "image/jpeg" : path.endsWith(".png") ? "image/png" : "image/webp";
    return data.byteLength ? new Blob([data], { type }) : undefined;
  }
  const db = await database();
  try {
    return await new Promise<Blob | undefined>((resolve, reject) => {
      const request = db.transaction("images").objectStore("images").get([id, path]);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

export async function storeLessonImages(id: string, images: LessonImages) {
  if (isTauri()) {
    for (const [path, blob] of images) {
      await invoke("put_lesson_image", await blob.arrayBuffer(), {
        headers: { "soma-lesson-id": id, "soma-image-path": path },
      });
    }
    return;
  }
  return putLessonRecords(id, "images", images);
}

export function removeLessonImages(id: string, canRemove: () => boolean) {
  return removeLessonRecords(id, "images", canRemove);
}

export async function retainLessonImages(id: string, paths: ReadonlySet<string>, expected?: Lesson | string) {
  const expectedJson = typeof expected === "string" ? expected : expected ? JSON.stringify(expected) : null;
  if (isTauri()) return invoke<void>("retain_lesson_images", { id, keep: [...paths], expected: expectedJson });
  const key = LESSON_STORAGE_PREFIX + id;
  return removeLessonRecords(id, "images", () => localStorage.getItem(key) === expectedJson, paths);
}

export async function readLessonImage(blob: Blob, onProgress?: (stage: LessonImageStage) => void) {
  content.validate_lesson_image_size(blob.size);
  const result = await lessonJob({ operation: "image", bytes: new Uint8Array(await blob.arrayBuffer()) }, onProgress);
  return { path: result.image!.path, blob: new Blob([result.bytes!], { type: result.image!.mime }) };
}

export function checkImageCollection(images: LessonImages) {
  content.validate_lesson_images([...images].map(([path, blob]) => [path, blob.size]));
}

export async function prepareImportedLesson(lesson: Lesson, previous: Lesson | undefined, stored: LessonImages, incoming: LessonImages) {
  const json = JSON.stringify(lesson);
  const sizes: [string, number][] = [...stored].map(([path, blob]) => [path, blob.size]);
  if (!incoming.size) {
    content.imported_lesson_image_additions(json, sizes, []);
    return { importedLesson: lesson, additions: new Map<string, Blob>() };
  }
  const referenced = previous && lessonImagePaths(previous);
  const existing = [...stored].filter(([path]) => referenced?.has(path));
  const readImageBytes = (entries: Iterable<[string, Blob]>) => Promise.all(Array.from(entries, async ([path, blob]): Promise<[string, Uint8Array<ArrayBuffer>]> =>
    [path, new Uint8Array(await blob.arrayBuffer())]));
  const [existingBytes, incomingBytes] = await Promise.all([readImageBytes(existing), readImageBytes(incoming)]);
  const result = await lessonJob({ operation: "prepare-import", json, stored: sizes, existing: existingBytes, incoming: incomingBytes });
  return {
    importedLesson: JSON.parse(result.json!) as Lesson,
    additions: new Map(result.additions!.map(path => [path, incoming.get(path)!])),
  };
}
