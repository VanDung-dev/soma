import { convertFileSrc } from "@tauri-apps/api/core";
import { resolveResource } from "@tauri-apps/api/path";

export const usesBundledModels = import.meta.env.MODE === "desktop";

export async function fetchModelAsset(path: string, init: RequestInit): Promise<Response> {
  const url = usesBundledModels
    ? convertFileSrc(await resolveResource(path))
    : `${import.meta.env.BASE_URL}${path}`;
  return fetch(url, init);
}

export function modelMetadataPath(path: string) {
  return path.replace(/\.glb(?:\.br)?$/, ".json");
}

export async function fetchModelMetadata<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetchModelAsset(path, init);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.json() as T;
}

export function requireRootMetadata<T>(metadata: Record<string, T>, rootId: string): T {
  const entry = metadata[rootId];
  if (!entry) throw new Error("Missing system metadata");
  return entry;
}
