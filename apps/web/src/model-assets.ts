import { convertFileSrc } from "@tauri-apps/api/core";
import { resolveResource } from "@tauri-apps/api/path";
import type { Catalog } from "./catalog/types";

export const usesBundledModels = import.meta.env.MODE === "desktop";

export async function fetchModelAsset(path: string, init: RequestInit): Promise<Response> {
  const url = usesBundledModels
    ? convertFileSrc(await resolveResource(path))
    : `${import.meta.env.BASE_URL}${path}`;
  return fetch(url, init);
}

export async function loadModelMetadata(catalog: Catalog, signal: AbortSignal) {
  signal.throwIfAborted();
  const files = await Promise.all(catalog.modelMetadataPaths().map(async path => {
    const response = await fetchModelAsset(path, { signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return [path, await response.text()] as const;
  }));
  signal.throwIfAborted();
  catalog.ingestModelMetadataFiles(Object.fromEntries(files));
}
