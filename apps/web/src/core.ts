import { invoke, isTauri } from "@tauri-apps/api/core";

export interface Catalog {
  schema_version: number;
  groups: { id: string; title: string }[];
  targets: StudyTarget[];
}

export interface StudyTarget { id: string; title: string; source_name: string; group_id: string; parent_id?: string; structure_ids: string[]; model?: Model }

export interface Model { path: string; scope: string; structure_ids: string[] }

let wasm: Promise<typeof import("./wasm/anatomy_wasm.js")> | undefined;

export function getWasm() {
  return wasm ??= import("./wasm/anatomy_wasm.js").then(async module => {
    await module.default();
    return module;
  });
}

export async function getCatalog(): Promise<Catalog> {
  let json: string;
  if (isTauri()) {
    json = await invoke<string>("get_catalog");
  } else {
    json = (await getWasm()).get_catalog();
  }
  return JSON.parse(json) as Catalog;
}
