import { convertFileSrc } from "@tauri-apps/api/core";
import { resolveResource } from "@tauri-apps/api/path";

export const usesBundledModels = import.meta.env.MODE === "desktop";

export async function fetchModelAsset(path: string, init: RequestInit): Promise<Response> {
  const url = usesBundledModels
    ? convertFileSrc(await resolveResource(path))
    : `${import.meta.env.BASE_URL}${path}`;
  return fetch(url, init);
}
