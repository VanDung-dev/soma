import * as content from "../content/content.js";
import { lessonJob } from "./archive";

export type LessonImages = Map<string, Blob>;

async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("soma-lesson-images", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("images");
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Lesson image storage is blocked"));
  });
}

export async function loadLessonImages(id: string) {
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

export async function loadLessonImage(id: string, path: string) {
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

export async function readLessonImage(blob: Blob) {
  content.validate_lesson_image_size(blob.size);
  const result = await lessonJob({ operation: "image", bytes: new Uint8Array(await blob.arrayBuffer()) });
  return { path: result.image!.path, blob: new Blob([result.bytes!], { type: result.image!.mime }) };
}

export function checkImageCollection(images: LessonImages) {
  content.validate_lesson_images([...images].map(([path, blob]) => [path, blob.size]));
}
