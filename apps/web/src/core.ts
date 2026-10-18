import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Catalog } from "./catalog/types";

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
