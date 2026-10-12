import { invoke, isTauri } from "@tauri-apps/api/core";

export interface Catalog {
  schema_version: number;
  groups: { id: string; title: string }[];
  targets: StudyTarget[];
}

export interface StudyTarget { id: string; title: string; source_name: string; group_id: string; parent_id?: string; structure_ids: string[]; definition_key: string; model?: Model }

export interface Model { path: string; scope: string }

export async function getCatalog(): Promise<Catalog> {
  let json: string;
  if (isTauri()) {
    json = await invoke<string>("get_catalog");
  } else {
    const wasm = await import("./wasm/anatomy_wasm.js");
    await wasm.default();
    json = wasm.get_catalog();
  }
  return JSON.parse(json) as Catalog;
}
