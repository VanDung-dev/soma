import type { StudyTarget } from "../catalog/types";
import type { PreparedGeometry } from "./contracts";
import { fetchModelAsset, usesBundledModels } from "../../model-assets";

export async function* loadModels(roots: StudyTarget[], signal: AbortSignal, onProgress: (loaded: number) => void,
  ingest: (root: StudyTarget, json: string) => string[], overview?: boolean) {
  signal.throwIfAborted();
  if (!roots.length) return;
  const model = roots[0]!.model!;
  if (roots.some(root => root.model?.path !== model.path || root.model.sha256 !== model.sha256)) {
    throw new Error("Model roots must share one bundle");
  }
  const worker = new Worker(new URL("./model-worker.ts", import.meta.url), { type: "module" });
  const downloadAbort = new AbortController();
  let cache: IDBDatabase | undefined;
  let cancelPreparation: (() => void) | undefined;
  const cancel = () => { downloadAbort.abort(signal.reason); cancelPreparation?.(); };
  signal.addEventListener("abort", cancel);
  try {
    try {
      if (!usesBundledModels && globalThis.indexedDB && model.sha256) {
        cache = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("anatomy-models-v1", 1);
          request.onupgradeneeded = () => request.result.createObjectStore("models");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }
    } catch {}
    signal.throwIfAborted();
    const metadataResponse = await fetchModelAsset(model.path.replace(/\.glb(?:\.br)?$/, ".json"), {
      signal: downloadAbort.signal, cache: "no-cache",
    });
    if (!metadataResponse.ok) throw new Error(`HTTP ${metadataResponse.status}`);
    const bundle = await metadataResponse.json() as {
      manifest: { models: { source_ids: string[] }[] };
      metadata: Record<string, { structures: unknown[] }>;
    };
    const selected = roots.flatMap(root => {
      const metadata = bundle.metadata[root.id];
      if (!metadata) throw new Error("Missing system metadata");
      return ingest(root, JSON.stringify(metadata));
    });
    signal.throwIfAborted();
    let bytes: ArrayBuffer | undefined;
    if (cache) {
      try {
        const saved = await new Promise<{ version: string; bytes: ArrayBuffer | Blob } | undefined>((resolve, reject) => {
          const request = cache!.transaction("models").objectStore("models").get(model.path);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        if (saved?.version === model.sha256) bytes = saved.bytes instanceof Blob ? await saved.bytes.arrayBuffer() : saved.bytes;
      } catch {}
    }
    signal.throwIfAborted();
    if (!bytes) {
      const response = await fetchModelAsset(model.path, { signal: downloadAbort.signal, cache: "no-cache" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      bytes = await response.arrayBuffer();
      if (cache) {
        try {
          await new Promise<void>((resolve, reject) => {
            const transaction = cache!.transaction("models", "readwrite");
            transaction.objectStore("models").put({ version: model.sha256, bytes: new Blob([bytes!]) }, model.path);
            transaction.oncomplete = () => resolve();
            transaction.onabort = transaction.onerror = () => reject(transaction.error);
          });
        } catch {}
      }
    }
    signal.throwIfAborted();
    const prepared = await new Promise<PreparedGeometry>((resolve, reject) => {
      cancelPreparation = () => reject(new DOMException("Model loading cancelled", "AbortError"));
      worker.onmessage = ({ data }) => data.error ? reject(new Error(data.error)) : resolve(data.prepared);
      worker.onerror = event => reject(new Error(event.message));
      worker.onmessageerror = () => reject(new Error("Cannot transfer prepared geometry"));
      worker.postMessage({ bytes: new Uint8Array(bytes), ids: bundle.manifest.models.flatMap(model => model.source_ids), selected, overview }, [bytes]);
    });
    cancelPreparation = undefined;
    signal.throwIfAborted();
    for (let index = 0; index < roots.length; index++) {
      onProgress(index + 1);
      signal.throwIfAborted();
    }
    yield prepared;
  } finally {
    downloadAbort.abort();
    cache?.close();
    worker.terminate();
    signal.removeEventListener("abort", cancel);
  }
}
