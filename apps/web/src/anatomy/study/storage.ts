import { invoke, isTauri } from "@tauri-apps/api/core";
import { openIndexedDatabase, transactionComplete } from "../../indexed-db";

let pendingWrite = Promise.resolve();

function database() {
  return openIndexedDatabase("soma-anatomy-state", 1, db => db.createObjectStore("state"),
    { closeOnVersionChange: true, blockedMessage: "Anatomy state storage is blocked" });
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
      const transaction = db.transaction("state", "readwrite");
      transaction.objectStore("state").put(ids, "hiddenIds");
      await transactionComplete(transaction);
    } finally { db.close(); }
  };
  pendingWrite = pendingWrite.catch(() => {}).then(write);
  return pendingWrite;
}
