import { invoke, isTauri } from "@tauri-apps/api/core";

let pendingWrite = Promise.resolve();

async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("soma-anatomy-state", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("state");
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Anatomy state storage is blocked"));
  });
}

export async function loadAnatomyHiddenIds() {
  if (isTauri()) return invoke<string[] | null>("load_anatomy_hidden_ids");
  const db = await database();
  try {
    return await new Promise<string[] | null>((resolve, reject) => {
      const request = db.transaction("state").objectStore("state").get("hiddenIds");
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

export function saveAnatomyHiddenIds(ids: string[]) {
  const write = async () => {
    if (isTauri()) return invoke<void>("save_anatomy_hidden_ids", { ids });
    const db = await database();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction("state", "readwrite");
        transaction.objectStore("state").put(ids, "hiddenIds");
        transaction.oncomplete = () => resolve();
        transaction.onabort = transaction.onerror = () => reject(transaction.error);
      });
    } finally { db.close(); }
  };
  pendingWrite = pendingWrite.catch(() => {}).then(write);
  return pendingWrite;
}
