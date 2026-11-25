import { invoke, isTauri } from "@tauri-apps/api/core";
import { Catalog } from "./catalog";
import * as bindings from "./wasm/wasm";
import * as content from "./content/content";

let wasm: Promise<typeof import("./wasm/wasm.js")> | undefined;
let data: Promise<typeof import("./content/content.js")> | undefined;

export function getWasm() {
  return wasm ??= bindings.default().then(() => bindings);
}

export function getContent() { return data ??= content.default().then(() => content); }

export async function getCatalog(): Promise<Catalog> {
  const content = await getContent();
  if (isTauri()) {
    return new Catalog(content.CatalogData.from_json(await invoke<string>("get_catalog")));
  }
  return new Catalog(new content.CatalogData());
}
