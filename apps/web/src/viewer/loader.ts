import type { Structure, StudyTarget } from "../catalog/types";
import type { PreparedGeometry } from "./contracts";

export function validateMetadata(value: unknown, expectedIds: string[]): Structure[] {
  const structures = (value as { structures?: Structure[] } | null)?.structures;
  if (!Array.isArray(structures) || !structures.length
    || !structures.every(s => s && [s.source_id, s.source_name, s.source_object, s.latin].every(v => typeof v === "string")
      && s.source_id && s.source_name && ["", "left", "right"].includes(s.laterality)
      && Array.isArray(s.collections) && s.collections.every(c => typeof c === "string"))
    || new Set(structures.map(s => s.source_id)).size !== structures.length) throw new Error("Metadata không hợp lệ");
  if (JSON.stringify(structures.map(s => s.source_id).sort()) !== JSON.stringify(expectedIds.slice().sort())) {
    throw new Error("Metadata không khớp catalog");
  }
  return structures;
}

export async function loadModels(roots: StudyTarget[], signal: AbortSignal, onProgress: (loaded: number) => void) {
  signal.throwIfAborted();
  const downloads = roots.map(async root => {
    const model = root.model!;
    const [response, metadataResponse] = await Promise.all([
      fetch(`${import.meta.env.BASE_URL}${model.path}`, { signal }),
      fetch(`${import.meta.env.BASE_URL}${model.path.replace(/\.glb$/, ".json")}`, { signal }),
    ]);
    if (!response.ok || !metadataResponse.ok) throw new Error(`HTTP ${response.status}/${metadataResponse.status}`);
    const structures = validateMetadata(await metadataResponse.json(), model.structure_ids);
    return { bytes: new Uint8Array(await response.arrayBuffer()), structures };
  }).map(promise => promise.catch(cause => ({ cause })));
  const worker = new Worker(new URL("./model-worker.ts", import.meta.url), { type: "module" });
  let cancelPreparation: (() => void) | undefined;
  const cancel = () => cancelPreparation?.();
  signal.addEventListener("abort", cancel);
  const packages: { prepared: PreparedGeometry; structures: Structure[] }[] = [];
  try {
    for (const download of downloads) {
      const pkg = await download;
      signal.throwIfAborted();
      if ("cause" in pkg) throw pkg.cause;
      const prepared = await new Promise<PreparedGeometry>((resolve, reject) => {
        cancelPreparation = () => reject(new DOMException("Model loading cancelled", "AbortError"));
        worker.onmessage = ({ data }) => data.error ? reject(new Error(data.error)) : resolve(data.prepared);
        worker.onerror = event => reject(new Error(event.message));
        worker.onmessageerror = () => reject(new Error("Cannot transfer prepared geometry"));
        worker.postMessage({ packages: [pkg.bytes], idsJson: JSON.stringify([pkg.structures.map(s => s.source_id)]) }, [pkg.bytes.buffer]);
      });
      cancelPreparation = undefined;
      signal.throwIfAborted();
      packages.push({ prepared, structures: pkg.structures });
      onProgress(packages.length);
    }
    return packages;
  } finally {
    worker.terminate();
    signal.removeEventListener("abort", cancel);
  }
}
