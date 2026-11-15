import { invoke, isTauri } from "@tauri-apps/api/core";
import * as content from "../../content/content.js";
import { lessonJob } from "./archive";
import type { LessonImageStage } from "./archive";
import type { Lesson } from "./contract";

export type LessonImages = Map<string, Blob>;

async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("soma-lesson-images", 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("images")) request.result.createObjectStore("images");
      if (!request.result.objectStoreNames.contains("content")) request.result.createObjectStore("content");
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Lesson image storage is blocked"));
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
  const db = await database();
  try {
    return await new Promise<LessonImages>((resolve, reject) => {
      const transaction = db.transaction("images");
      const request = transaction.objectStore("images").openCursor(IDBKeyRange.bound([id, ""], [id, "\uffff"]));
      const images: LessonImages = new Map();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        images.set((cursor.key as string[])[1]!, cursor.value as Blob);
        cursor.continue();
      };
      transaction.oncomplete = () => resolve(images);
      transaction.onabort = transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
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

export async function storeBrowserLessonContent(id: string, contents: ReadonlyMap<string, string>) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("content", "readwrite");
      const store = transaction.objectStore("content");
      for (const [path, html] of contents) store.put(html, [id, path]);
      transaction.oncomplete = () => resolve();
      transaction.onabort = transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

export async function retainBrowserLessonContent(id: string, paths: ReadonlySet<string>, canRemove: () => boolean = () => true) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("content", "readwrite");
      const request = transaction.objectStore("content").openCursor(IDBKeyRange.bound([id, ""], [id, "\uffff"]));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || !canRemove()) return;
        if (!paths.has((cursor.key as string[])[1]!)) cursor.delete();
        cursor.continue();
      };
      transaction.oncomplete = () => resolve();
      transaction.onabort = transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
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
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("images", "readwrite");
      for (const [path, blob] of images) transaction.objectStore("images").put(blob, [id, path]);
      transaction.oncomplete = () => resolve();
      transaction.onabort = transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

export async function removeLessonImages(id: string, canRemove: () => boolean) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("images", "readwrite");
      const request = transaction.objectStore("images").openCursor(IDBKeyRange.bound([id, ""], [id, "\uffff"]));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || !canRemove()) return;
        cursor.delete();
        cursor.continue();
      };
      transaction.oncomplete = () => resolve();
      transaction.onabort = transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

export async function retainLessonImages(id: string, paths: ReadonlySet<string>, expected?: Lesson) {
  if (isTauri()) return invoke<void>("retain_lesson_images", { id, keep: [...paths], expected: expected ? JSON.stringify(expected) : null });
  const key = `soma.lesson:${id}`;
  const expectedJson = expected ? JSON.stringify(expected) : null;
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("images", "readwrite");
      const request = transaction.objectStore("images").openCursor(IDBKeyRange.bound([id, ""], [id, "\uffff"]));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (localStorage.getItem(key) !== expectedJson) return;
        if (!paths.has((cursor.key as string[])[1]!)) cursor.delete();
        cursor.continue();
      };
      transaction.oncomplete = () => resolve();
      transaction.onabort = transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

export async function readLessonImage(blob: Blob, onProgress?: (stage: LessonImageStage) => void) {
  content.validate_lesson_image_size(blob.size);
  const result = await lessonJob({ operation: "image", bytes: new Uint8Array(await blob.arrayBuffer()) }, onProgress);
  return { path: result.image!.path, blob: new Blob([result.bytes!], { type: result.image!.mime }) };
}

export function checkImageCollection(images: LessonImages) {
  content.validate_lesson_images([...images].map(([path, blob]) => [path, blob.size]));
}
