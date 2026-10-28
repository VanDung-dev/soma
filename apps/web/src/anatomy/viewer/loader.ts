import type { StudyTarget } from "../catalog/types";
import type { PreparedGeometry } from "./contracts";

export async function* loadModels(roots: StudyTarget[], signal: AbortSignal, onProgress: (loaded: number) => void,
  ingest: (root: StudyTarget, json: string) => string[]) {
  signal.throwIfAborted();
  const worker = new Worker(new URL("./model-worker.ts", import.meta.url), { type: "module" });
  const downloadAbort = new AbortController();
  const download = async (root: StudyTarget): Promise<{ bytes: Uint8Array; metadata: string } | { cause: unknown }> => {
    try {
      const model = root.model!;
      const [response, metadataResponse] = await Promise.all([
        fetch(`${import.meta.env.BASE_URL}${model.path}`, { signal: downloadAbort.signal }),
        fetch(`${import.meta.env.BASE_URL}${model.path.replace(/\.glb(?:\.br)?$/, ".json")}`, { signal: downloadAbort.signal }),
      ]);
      if (!response.ok || !metadataResponse.ok) throw new Error(`HTTP ${response.status}/${metadataResponse.status}`);
      return { bytes: new Uint8Array(await response.arrayBuffer()), metadata: await metadataResponse.text() };
    } catch (cause) { return { cause }; }
  };
  let cancelPreparation: (() => void) | undefined;
  const cancel = () => { downloadAbort.abort(signal.reason); cancelPreparation?.(); };
  signal.addEventListener("abort", cancel);
  try {
    const downloads = roots.slice(0, 2).map(download);
    for (let index = 0; index < roots.length; index++) {
      const pkg = await downloads.shift()!;
      signal.throwIfAborted();
      if ("cause" in pkg) throw pkg.cause;
      const ids = ingest(roots[index]!, pkg.metadata);
      const prepared = await new Promise<PreparedGeometry>((resolve, reject) => {
        cancelPreparation = () => reject(new DOMException("Model loading cancelled", "AbortError"));
        worker.onmessage = ({ data }) => data.error ? reject(new Error(data.error)) : resolve(data.prepared);
        worker.onerror = event => reject(new Error(event.message));
        worker.onmessageerror = () => reject(new Error("Cannot transfer prepared geometry"));
        worker.postMessage({ packages: [pkg.bytes], ids: [ids] }, [pkg.bytes.buffer]);
      });
      cancelPreparation = undefined;
      signal.throwIfAborted();
      onProgress(index + 1);
      signal.throwIfAborted();
      yield prepared;
      if (index + 2 < roots.length) downloads.push(download(roots[index + 2]!));
    }
  } finally {
    downloadAbort.abort();
    worker.terminate();
    signal.removeEventListener("abort", cancel);
  }
}
