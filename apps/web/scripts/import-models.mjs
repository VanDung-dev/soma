import assert from 'node:assert/strict';
import { readFile, mkdir, copyFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import validator from 'gltf-validator';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const venvPython = join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const python = process.env.PYTHON_BIN ?? (existsSync(venvPython) ? venvPython : process.platform === 'win32' ? 'python' : 'python3');
const preparation = spawnSync(python, [join(root, 'apps/web/scripts/download-z-anatomy.py')], { cwd: root, stdio: 'inherit', timeout: 600000 });
assert.ifError(preparation.error);
assert.equal(preparation.status, 0, `Source preparation failed: ${preparation.signal ?? preparation.status}`);
const blender = process.env.BLENDER_BIN ?? (process.platform === 'darwin' ? '/Applications/Blender.app/Contents/MacOS/Blender' : 'blender');
const result = spawnSync(blender, ['--background', '--factory-startup', '--disable-autoexec', join(root, 'Z-Anatomy/Startup.blend'), '--python-exit-code', '1', '--python', join(root, 'apps/web/scripts/export-z-anatomy.py')], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 600000 });
console.log(result.status === 0 ? result.stdout.split('\n').filter(line => /EXPORTED|WARNING/.test(line)).join('\n') : result.stdout);
if (result.stderr) console.error(result.stderr);
assert.ifError(result.error);
assert.equal(result.status, 0, `Blender export failed: ${result.signal ?? result.status}`);
const stage = join(root, '.cache/z-anatomy/export');
const output = join(root, 'apps/web/public/models/z-anatomy');
const manifest = JSON.parse(await readFile(join(stage, 'manifest.json')));
const catalog = JSON.parse(await readFile(join(stage, 'catalog.json')));
assert.equal(manifest.models.length, 9);
assert.equal(catalog.groups.length, 9);
assert.equal(catalog.targets.filter(t => !t.parent_id).length, 9);
for (const model of manifest.models) {
  assert(catalog.targets.some(t => t.model?.path === `models/z-anatomy/${model.file}`), model.file);
  const bytes = await readFile(join(stage, model.file));
  const metadata = await readFile(join(stage, model.metadata_file));
  const report = await validator.validateBytes(new Uint8Array(bytes), { uri: model.file });
  assert.equal(report.issues.numErrors, 0, JSON.stringify(report.issues.messages));
  assert.equal(report.issues.numWarnings, 0, JSON.stringify(report.issues.messages));
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
  assert.deepEqual(gltf.nodes.filter(n => n.extras?.source_id).map(n => n.extras.source_id).sort(), model.source_ids);
  const pkg = JSON.parse(metadata);
  assert.deepEqual(pkg.structures.map(s => s.source_id).sort(), model.source_ids);
  model.primitives = gltf.meshes.reduce((sum, mesh) => sum + mesh.primitives.length, 0);
  model.triangles = gltf.meshes.reduce((sum, mesh) => sum + mesh.primitives.reduce((n, p) => n + (gltf.accessors[p.indices ?? p.attributes.POSITION].count / 3), 0), 0);
  model.bytes = bytes.length;
  model.sha256 = createHash('sha256').update(bytes).digest('hex');
  model.metadata_bytes = metadata.length;
  model.metadata_sha256 = createHash('sha256').update(metadata).digest('hex');
  console.log(`${model.file}: ${model.structures} structures, ${model.definitions} definitions; GLB validation passed`);
}
// Publish only after every staged package has passed validation.
await mkdir(output, { recursive: true });
for (const model of manifest.models) {
  await copyFile(join(stage, model.file), join(output, model.file));
  await copyFile(join(stage, model.metadata_file), join(output, model.metadata_file));
}
await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
await copyFile(join(stage, 'catalog.json'), join(root, 'content/catalog.json'));
const active = new Set(['manifest.json', ...manifest.models.flatMap(m => [m.file, m.metadata_file])]);
for (const file of await readdir(output)) {
  if (/^[a-z-]+\.(glb|json)$/.test(file) && !active.has(file)) await unlink(join(output, file));
}
