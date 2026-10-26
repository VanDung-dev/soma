import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { initSync, prepare_packages } from "../src/wasm/wasm.js";

initSync({ module: readFileSync(new URL("../src/wasm/wasm_bg.wasm", import.meta.url)) });

test("Rust prepares transferable geometry with matching identities and rejects invalid packages", () => {
  const folder = new URL("../public/models/z-anatomy/", import.meta.url);
  const bytes = new Uint8Array(readFileSync(new URL("body-regions.glb", folder)));
  const metadata = JSON.parse(readFileSync(new URL("body-regions.json", folder), "utf8"));
  const ids = metadata.structures.map(s => s.source_id);
  const [vertices, indices, descriptor] = prepare_packages([bytes], JSON.stringify([ids]));
  assert(vertices instanceof Float32Array);
  assert(indices instanceof Uint32Array);
  const packed = JSON.parse(descriptor);
  assert.equal(vertices.length, packed.vertex_count * 6);
  assert.equal(indices.length, packed.index_count);
  assert.deepEqual([...new Set(packed.scene.parts.map(p => p.source_id))].sort(), ids.sort());
  assert(vertices.every(Number.isFinite));
  assert(indices.every(i => i < packed.vertex_count));
  assert(packed.scene.parts.every(p => !Object.hasOwn(p, "vertices") && !Object.hasOwn(p, "indices")));
  const copied = structuredClone([vertices, indices], { transfer: [vertices.buffer, indices.buffer] });
  assert.equal(vertices.byteLength, 0);
  assert.equal(copied[0].length, packed.vertex_count * 6);
  assert.throws(() => prepare_packages([bytes], "[]"));
  assert.throws(() => prepare_packages([bytes], JSON.stringify([ids.slice(1)])));
  assert.throws(() => prepare_packages([new Uint8Array([1, 2, 3])], JSON.stringify([ids])));
});
