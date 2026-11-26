import type { Catalog, ModelBundlePlan } from "../catalog/types";
import type { PreparedModelMetadata } from "../content/content";
import type { PreparedGeometry } from "./contracts";
import { openIndexedDatabase, transactionComplete } from "../indexed-db";
import { fetchModelAsset, usesBundledModels } from "../model-assets";

export async function* loadModels(catalog: Catalog, bundle: ModelBundlePlan, signal: AbortSignal,
  onProgress: (loaded: number) => void, overview?: boolean) {
  signal.throwIfAborted();
  const worker = new Worker(new URL("./model-worker.ts", import.meta.url), { type: "module" });
  const downloadAbort = new AbortController();
  let metadata: PreparedModelMetadata | undefined;
  let cache: IDBDatabase | undefined;
  let cancelPreparation: (() => void) | undefined;
  const cancel = () => { downloadAbort.abort(signal.reason); cancelPreparation?.(); };
  signal.addEventListener("abort", cancel);
  try {
    try {
      if (!usesBundledModels && globalThis.indexedDB && bundle.sha256) {
        cache = await openIndexedDatabase("anatomy-models-v1", 1, db => db.createObjectStore("models"));
      }
    } catch {}
    signal.throwIfAborted();
    const response = await fetchModelAsset(bundle.metadataPath, { signal: downloadAbort.signal, cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json = await response.text();
    signal.throwIfAborted();
    metadata = catalog.prepareModelMetadata(bundle.rootIds, json);
    const [ids, selected]: [string[], string[]] = metadata.geometry_ids();
    signal.throwIfAborted();
    let bytes: ArrayBuffer | undefined;
    if (cache) {
      try {
        const saved = await new Promise<{ version: string; bytes: ArrayBuffer | Blob } | undefined>((resolve, reject) => {
          const request = cache!.transaction("models").objectStore("models").get(bundle.path);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        if (saved?.version === bundle.sha256) bytes = saved.bytes instanceof Blob ? await saved.bytes.arrayBuffer() : saved.bytes;
      } catch {}
    }
    signal.throwIfAborted();
    if (!bytes) {
      const response = await fetchModelAsset(bundle.path, { signal: downloadAbort.signal, cache: "no-cache" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      bytes = await response.arrayBuffer();
      if (cache) {
        try {
          const transaction = cache.transaction("models", "readwrite");
          transaction.objectStore("models").put({ version: bundle.sha256, bytes: new Blob([bytes]) }, bundle.path);
          await transactionComplete(transaction);
        } catch {}
      }
    }
    signal.throwIfAborted();
    const prepared = await new Promise<PreparedGeometry>((resolve, reject) => {
      cancelPreparation = () => reject(new DOMException("Model loading cancelled", "AbortError"));
      worker.onmessage = ({ data }) => data.error ? reject(new Error(data.error)) : resolve(data.prepared);
      worker.onerror = event => reject(new Error(event.message));
      worker.onmessageerror = () => reject(new Error("Cannot transfer prepared geometry"));
      worker.postMessage({ bytes: new Uint8Array(bytes), ids, selected, overview }, [bytes]);
    });
    cancelPreparation = undefined;
    signal.throwIfAborted();
    for (let index = 0; index < bundle.rootIds.length; index++) {
      onProgress(index + 1);
      signal.throwIfAborted();
    }
    yield { geometry: prepared, metadata };
  } finally {
    downloadAbort.abort();
    cache?.close();
    worker.terminate();
    signal.removeEventListener("abort", cancel);
    metadata?.free();
  }
}
