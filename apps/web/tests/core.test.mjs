import { readFileSync } from "node:fs";
import { test } from "node:test";
import { deepStrictEqual } from "node:assert/strict";
import { initSync, get_catalog } from "../src/wasm/anatomy_wasm.js";

test("WebAssembly catalog matches the native core's source data", () => {
  initSync({ module: readFileSync(new URL("../src/wasm/anatomy_wasm_bg.wasm", import.meta.url)) });
  const source = JSON.parse(readFileSync(new URL("../../../content/catalog.json", import.meta.url), "utf8"));
  deepStrictEqual(JSON.parse(get_catalog()), source);
});
