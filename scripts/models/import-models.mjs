import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile, readdir, unlink, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib';
import validator from 'gltf-validator';

assert.equal(constants.BROTLI_DECODER_ERROR_FORMAT_BLOCK_SWITCH, -17, 'A Node.js release with the Brotli security fix is required');

function formatJson(value, indent = 0) {
  const space = ' '.repeat(indent);
  if (Array.isArray(value)) {
    return '[\n' + value.map(record => space + '  ' + JSON.stringify(record)).join(',\n') + '\n' + space + ']';
  }
  if (value !== null && typeof value === 'object') {
    return '{\n' + Object.entries(value).map(([key, entry]) =>
      space + '  ' + JSON.stringify(key) + ': ' + formatJson(entry, indent + 2)).join(',\n') + '\n' + space + '}';
  }
  return JSON.stringify(value);
}

const root = fileURLToPath(new URL('../../', import.meta.url));
const venvPython = join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const python = process.env.PYTHON_BIN ?? (existsSync(venvPython) ? venvPython : process.platform === 'win32' ? 'python' : 'python3');
const preparation = spawnSync(python, [join(root, 'scripts/models/download-z-anatomy.py')], { cwd: root, stdio: 'inherit', timeout: 600000 });
assert.ifError(preparation.error);
assert.equal(preparation.status, 0, `Source preparation failed: ${preparation.signal ?? preparation.status}`);
const blender = process.env.BLENDER_BIN ?? (process.platform === 'darwin' ? '/Applications/Blender.app/Contents/MacOS/Blender' : 'blender');
const result = spawnSync(blender, ['--background', '--factory-startup', '--disable-autoexec', join(root, 'Z-Anatomy/Startup.blend'), '--python-exit-code', '1', '--python', join(root, 'scripts/models/export-z-anatomy.py')], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 600000 });
console.log(result.status === 0 ? result.stdout.split('\n').filter(line => /EXPORTED|WARNING/.test(line)).join('\n') : result.stdout);
if (result.stderr) console.error(result.stderr);
assert.ifError(result.error);
assert.equal(result.status, 0, `Blender export failed: ${result.signal ?? result.status}`);
const stage = join(root, '.cache/z-anatomy/export');
const output = join(root, 'apps/web/public/models/z-anatomy');
const manifest = JSON.parse(await readFile(join(stage, 'manifest.json')));
let catalogText = await readFile(join(stage, 'catalog.json'), 'utf8');
const catalog = JSON.parse(catalogText);
assert.equal(manifest.models.length, 9);
assert.equal(catalog.groups.length, 9);
assert.equal(catalog.schema_version, 4);
assert.equal(catalog.targets.filter(t => !t.parent_id).length, 9);
const availableIds = new Set(manifest.models.flatMap(model => model.source_ids));
for (const target of catalog.targets) {
  assert(target.structure_ids.every(id => availableIds.has(id)), target.id);
  if (target.parent_id) {
    const parent = catalog.targets.find(entry => entry.id === target.parent_id);
    assert(parent && parent.group_id === target.group_id && target.structure_ids.every(id => parent.structure_ids.includes(id)), target.id);
  }
}
for (const model of manifest.models) {
  const target = catalog.targets.find(t => t.model?.path === `models/z-anatomy/${model.file}`);
  assert(target, model.file);
  assert.deepEqual(target.model.structure_ids, model.source_ids);
  const bytes = await readFile(join(stage, model.file));
  const metadata = await readFile(join(stage, model.metadata_file));
  const report = await validator.validateBytes(new Uint8Array(bytes), { uri: model.file });
  assert.equal(report.issues.numErrors, 0, JSON.stringify(report.issues.messages));
  assert.equal(report.issues.numWarnings, 0, JSON.stringify(report.issues.messages));
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
  assert.deepEqual(gltf.nodes.filter(n => n.extras?.source_id).map(n => n.extras.source_id).sort(), model.source_ids);
  const pkg = JSON.parse(metadata);
  assert.deepEqual(pkg.structures.map(s => s.source_id).sort(), model.source_ids);
  assert(!('definitions' in pkg) && !('collection_definitions' in pkg));
  assert(pkg.structures.every(s => !('definition_key' in s) && s.source_name));
  model.primitives = gltf.meshes.reduce((sum, mesh) => sum + mesh.primitives.length, 0);
  model.triangles = gltf.meshes.reduce((sum, mesh) => sum + mesh.primitives.reduce((n, p) => n + (gltf.accessors[p.indices ?? p.attributes.POSITION].count / 3), 0), 0);
  model.bytes = bytes.length;
  model.sha256 = createHash('sha256').update(bytes).digest('hex');
  model.metadata_bytes = metadata.length;
  model.metadata_sha256 = createHash('sha256').update(metadata).digest('hex');
  console.log(`${model.file}: ${model.structures} structures; GLB validation passed`);
}
const metadata = {};
for (const model of manifest.models) {
  const target = catalog.targets.find(t => t.model?.path === `models/z-anatomy/${model.file}`);
  model.root_id = target.id;
  metadata[target.id] = JSON.parse(await readFile(join(stage, model.metadata_file), 'utf8'));
}
const original = await readFile(join(stage, 'z-anatomy.glb'));
const jsonLength = original.readUInt32LE(12);
const document = JSON.parse(original.subarray(20, 20 + jsonLength));
const bytes = original;
const ids = document.nodes.filter(node => node.extras?.source_id).map(node => node.extras.source_id).sort();
assert.deepEqual(ids, [...availableIds].sort());
const accessorData = (gltf, binary, index) => {
  const { bufferView, ...accessor } = gltf.accessors[index];
  const { byteOffset = 0, buffer, ...view } = gltf.bufferViews[bufferView];
  assert.equal(buffer, 0);
  return { accessor, view, bytes: binary.subarray(byteOffset, byteOffset + view.byteLength) };
};
const binary = bytes.subarray(28 + jsonLength);
const combinedNodes = new Map(document.nodes.filter(node => node.extras?.source_id).map(node => [node.extras.source_id, node]));
for (const model of manifest.models) {
  const source = await readFile(join(stage, model.file));
  const length = source.readUInt32LE(12);
  const gltf = JSON.parse(source.subarray(20, 20 + length));
  for (const node of gltf.nodes.filter(node => node.extras?.source_id)) {
    const combined = combinedNodes.get(node.extras.source_id);
    for (const key of ['extras', 'matrix', 'translation', 'rotation', 'scale']) assert.deepEqual(combined[key], node[key]);
    const primitives = document.meshes[combined.mesh].primitives;
    const originals = gltf.meshes[node.mesh].primitives;
    assert.equal(primitives.length, originals.length);
    for (const [index, primitive] of originals.entries()) {
      const merged = primitives[index];
      assert.deepEqual(document.materials[merged.material], gltf.materials[primitive.material]);
      assert.deepEqual(Object.keys(merged.attributes).sort(), Object.keys(primitive.attributes).sort());
      for (const key of Object.keys(primitive.attributes)) {
        assert.deepEqual(accessorData(document, binary, merged.attributes[key]), accessorData(gltf, source.subarray(28 + length), primitive.attributes[key]));
      }
      assert.deepEqual(accessorData(document, binary, merged.indices), accessorData(gltf, source.subarray(28 + length), primitive.indices));
    }
  }
}
assert(bytes.length <= 256 * 1024 * 1024, 'Combined model exceeds the renderer limit');
const report = await validator.validateBytes(new Uint8Array(bytes), { uri: 'z-anatomy.glb' });
assert.equal(report.issues.numErrors, 0, JSON.stringify(report.issues.messages));
assert.equal(report.issues.numWarnings, 0, JSON.stringify(report.issues.messages));
const compressed = brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 6 } });
assert.deepEqual(brotliDecompressSync(compressed), bytes);
const sha256 = createHash('sha256').update(compressed).digest('hex');
manifest.bundle = { file: 'z-anatomy.glb.br', bytes: compressed.length, uncompressed_bytes: bytes.length, sha256 };
for (const target of catalog.targets.filter(target => target.model)) {
  catalogText = catalogText.replace(JSON.stringify(target.model.path), `${JSON.stringify('models/z-anatomy/z-anatomy.glb.br')}, "sha256": ${JSON.stringify(sha256)}`);
  target.model.path = 'models/z-anatomy/z-anatomy.glb.br';
  target.model.sha256 = sha256;
}
assert.deepEqual(JSON.parse(catalogText), catalog);
await mkdir(output, { recursive: true });
await writeFile(join(output, 'z-anatomy.glb.br.tmp'), compressed);
await rename(join(output, 'z-anatomy.glb.br.tmp'), join(output, 'z-anatomy.glb.br'));
const metadataJson = formatJson({ manifest, metadata }) + '\n';
assert.deepEqual(JSON.parse(metadataJson), { manifest, metadata });
await writeFile(join(output, 'z-anatomy.json'), metadataJson);
await writeFile(join(root, 'content/catalog.json'), catalogText);
for (const file of await readdir(output)) {
  if (/^[a-z-]+\.(glb(?:\.br)?|json)$/.test(file) && !['z-anatomy.glb.br', 'z-anatomy.json'].includes(file)) await unlink(join(output, file));
}
console.log(`z-anatomy.glb.br: ${ids.length} structures; ${bytes.length} raw bytes; ${compressed.length} compressed bytes; combined GLB validation passed`);

const inventory = new Map();
for (const model of manifest.models) {
  const pkg = metadata[model.root_id];
  for (const part of pkg.structures) {
    const entry = inventory.get(part.source_name) ?? { name: part.source_name, structure_ids: new Set() };
    entry.structure_ids.add(part.source_id);
    inventory.set(part.source_name, entry);
  }
}
await writeFile(join(root, 'content/anatomy-names.jsonl'), [...inventory.values()]
  .map(entry => ({ name: entry.name, structure_ids: [...entry.structure_ids].sort() }))
  .sort((a, b) => a.name.localeCompare(b.name, 'en'))
  .map(entry => JSON.stringify(entry))
  .join('\n') + '\n');
