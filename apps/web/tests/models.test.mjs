import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import validator from 'gltf-validator';
import { brotliDecompressSync } from 'node:zlib';
const folder = new URL('../public/models/z-anatomy/', import.meta.url);
const catalog = JSON.parse(await readFile(new URL('../../../content/catalog.json', import.meta.url)));
const manifest = JSON.parse(await readFile(new URL('manifest.json', folder)));
const selectionBytes = await readFile(new URL('../../../content/z-anatomy-selections.json', import.meta.url));
const selections = JSON.parse(selectionBytes);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const parseJsonl = text => text.split('\n').filter(Boolean).map(line => JSON.parse(line));
const availableIds = new Set(manifest.models.flatMap(m => m.source_ids));
test('Z-Anatomy preserves geometry, structure identity, names and materials', async () => {
  assert.equal(manifest.source, 'Z-Anatomy');
  assert.equal(manifest.models.length, 9);
  assert.equal(hash(selectionBytes), manifest.selections_sha256);
  const roots = catalog.targets.filter(t => !t.parent_id);
  assert.equal(roots.length, 9);
  assert.equal(catalog.groups.length, 9);
  assert.equal(new Set(roots.map(t => t.model.path)).size, 9);
  assert.equal(manifest.units, 'metres'); assert.equal(manifest.up_axis, 'Y');
  const inventory = new Map(), colors = new Set();
  for (const target of roots) {
    const record = manifest.models.find(m => target.model.path === 'models/z-anatomy/' + m.file);
    assert(record, target.id);
    assert.deepEqual(record.selection, selections[record.file.replace('.glb.br', '')]);
    const stored = await readFile(new URL(record.file, folder));
    assert.equal(record.compression, 'br');
    assert.equal(stored.length, record.bytes); assert.equal(hash(stored), record.sha256);
    const bytes = brotliDecompressSync(stored);
    const metadataBytes = await readFile(new URL(record.metadata_file, folder));
    assert.equal(bytes.length, record.uncompressed_bytes); assert.equal(hash(bytes), record.uncompressed_sha256);
    assert.equal(metadataBytes.length, record.metadata_bytes); assert.equal(hash(metadataBytes), record.metadata_sha256);
    const report = await validator.validateBytes(new Uint8Array(bytes), { uri: record.file.replace(/\.br$/, '') });
    assert.equal(report.issues.numErrors, 0, JSON.stringify(report.issues.messages));
    assert.equal(report.issues.numWarnings, 0, JSON.stringify(report.issues.messages));
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
    if (record.file === 'skeletal-system.glb.br') {
      for (const name of ['Femur.l · Web', 'Femur.r · Web']) {
        const node = gltf.nodes.find(n => n.name === name);
        assert.deepEqual(gltf.meshes[node.mesh].primitives.map(p => gltf.materials[p.material].name).sort(), ['Bone · Web PBR', 'Cartilage · Web PBR'], 'Articular surfaces must retain their own material');
      }
      const bone = gltf.materials.find(m => m.name === 'Bone · Web PBR');
      assert(Math.abs(bone.pbrMetallicRoughness.metallicFactor - 0.4903846085) < 1e-6, 'Preserve source bone reflectance');
    }
    const pkg = JSON.parse(metadataBytes), nodes = gltf.nodes.filter(n => n.extras?.source_id);
    assert(gltf.meshes.every(m => m.primitives.every(p => (p.mode ?? 4) === 4)));
    assert.deepEqual(nodes.map(n => n.extras.source_id).sort(), record.source_ids);
    assert.deepEqual(pkg.structures.map(s => s.source_id).sort(), record.source_ids);
    assert.equal(new Set(record.source_ids).size, record.structures);
    assert(!('definitions' in pkg) && !('collection_definitions' in pkg));
    const entries = catalog.targets.filter(t => t.group_id === target.group_id);
    assert.equal(entries.length, record.catalog_nodes);
    assert.deepEqual(target.model.structure_ids, record.source_ids);
    assert(record.source_ids.every(id => target.structure_ids.includes(id)));
    for (const entry of entries) {
      assert(entry.structure_ids.every(id => availableIds.has(id)));
      assert(!('definition_key' in entry));
      if (entry.parent_id) {
        const parent = entries.find(t => t.id === entry.parent_id);
        assert(parent);
        assert(entry.structure_ids.every(id => parent.structure_ids.includes(id)));
      }
    }
    for (const s of pkg.structures) {
      assert.equal(s.source_id, 'za:' + hash(s.source_object).slice(0, 16));
      assert(s.source_name && s.source_object); assert.equal(typeof s.latin, 'string');
      assert(['', 'left', 'right'].includes(s.laterality));
      assert(s.collections.length && s.collections.every(c => typeof c === 'string'));
      assert.deepEqual(nodes.find(n => n.extras.source_id === s.source_id).extras, s);
      if (inventory.has(s.source_id)) assert.deepEqual(inventory.get(s.source_id), s);
      inventory.set(s.source_id, s);
      assert(!('definition_key' in s));
    }
    for (const material of gltf.materials) {
      colors.add(JSON.stringify(material.pbrMetallicRoughness?.baseColorFactor));
      for (const key of ['source_specular', 'source_subsurface']) {
        assert(Number.isFinite(material.extras[key]) && material.extras[key] >= 0 && material.extras[key] <= 1, `${material.name}: ${key}`);
      }
      if (material.name === 'Cartilage · Web PBR') assert.equal(material.extras.source_subsurface, 1);
      if (material.name === 'Ductus · Web PBR') {
        const expected = [0.338579, 0.301595, 0.137033, 1];
        assert(material.pbrMetallicRoughness.baseColorFactor.every((v, i) => Math.abs(v - expected[i]) < 1e-5));
      }
    }
    const fascia = gltf.materials.find(m => m.name === 'Fascia · Web PBR');
    if (fascia) {
      assert.equal(fascia.alphaMode, 'BLEND', 'Fascia must not hide the muscles as an opaque shell');
      assert(Math.abs(fascia.pbrMetallicRoughness.baseColorFactor[3] - 0.15) < 1e-6, 'Preserve the source Fascia transparent-mix factor of 0.85');
    }
    assert.equal(gltf.meshes.reduce((n, m) => n + m.primitives.length, 0), record.primitives);
    assert.equal(gltf.meshes.reduce((n, m) => n + m.primitives.reduce((s, p) => s + gltf.accessors[p.indices ?? p.attributes.POSITION].count / 3, 0), 0), record.triangles);
  }
  assert.equal(inventory.size, manifest.unique_structures); assert.equal(inventory.size, 3874);
  assert(!('structures_with_definitions' in manifest));
  assert.equal(inventory.size + manifest.excluded_objects.length, 4224);
  assert.equal(manifest.repaired_meshes.length, 29);
  assert(manifest.repaired_meshes.every(m => inventory.has('za:' + hash(m.object).slice(0, 16)) && m.before.vertices > 0 && m.after.polygons > 0));
  assert(colors.size > 10);
  assert(manifest.excluded_objects.every(o => o.object && o.reason));
  const heart = JSON.parse(await readFile(new URL('cardiovascular-system.json', folder)));
  assert(heart.structures.some(s => s.source_name === 'Right atrium'));
  const names = parseJsonl(await readFile(new URL('../../../content/anatomy-names.jsonl', import.meta.url), 'utf8'));
  assert.equal(names.length, 2053);
  assert.equal(new Set(names.map(entry => entry.name)).size, names.length);
  assert.deepEqual(names.flatMap(entry => entry.structure_ids).sort(), [...inventory.keys()].sort());
  for (const entry of names) assert(entry.structure_ids.every(id => inventory.get(id).source_name === entry.name));
});

test('navigation follows nine source roots and keeps deep, scoped categories', async () => {
  assert.equal(catalog.schema_version, 4);
  assert.equal(catalog.targets.length, 1981);
  const roots = catalog.targets.filter(t => !t.parent_id);
  assert.deepEqual(roots.map(t => t.source_name), Object.values(selections).map(s => s.source_collection));
  const cardio = roots.find(t => t.group_id === 'group:cardiovascular-system');
  assert.deepEqual(catalog.targets.filter(t => t.parent_id === cardio.id).map(t => t.source_name), ['Vessels', 'Vascular plexuses', 'Pulmonary vessels', 'Cardiac vessels', 'Systemic arteries', 'Systemic veins', 'Great lymphatic vessels', 'Heart']);
  const heart = catalog.targets.find(t => t.parent_id === cardio.id && t.source_name === 'Heart');
  const atrium = catalog.targets.find(t => t.parent_id === heart.id && t.source_name === 'Right atrium');
  assert.equal(heart.structure_ids.length, 17);
  assert.equal(atrium.structure_ids.length, 1);
  const pkg = JSON.parse(await readFile(new URL('cardiovascular-system.json', folder)));
  assert.equal(pkg.structures.find(s => s.source_id === atrium.structure_ids[0]).source_name, 'Right atrium');
  assert(catalog.targets.some(t => t.structure_ids.length === 0));
  let maxDepth = 0;
  for (const t of catalog.targets) {
    const seen = new Set(); let entry = t;
    while (entry) { assert(!seen.has(entry.id)); seen.add(entry.id); entry = catalog.targets.find(p => p.id === entry.parent_id); }
    maxDepth = Math.max(maxDepth, seen.size);
  }
  assert.equal(maxDepth, 10);
});

test('names and cross-asset folders remain independent of descriptions', async () => {
  const muscular = JSON.parse(await readFile(new URL('muscular-system.json', folder)));
  const fascia = catalog.targets.find(t => t.source_name === 'Fascia');
  assert(fascia.structure_ids.length > 0);
  const visceral = JSON.parse(await readFile(new URL('visceral-systems.json', folder)));
  const mucosa = catalog.targets.find(t => t.source_name === 'Mucosa of stomach');
  const mesh = visceral.structures.find(s => s.source_object === 'Mucosa of stomach');
  assert.equal(mesh.source_name, 'Mucosa of stomach');
  assert(mucosa.structure_ids.includes(mesh.source_id));
  const skeletal = JSON.parse(await readFile(new URL('skeletal-system.json', folder)));
  const costal = skeletal.structures.filter(s => s.source_name === 'Costal cartilage of second rib');
  assert.equal(costal.length, 2);
  assert(costal.every(s => !('definition_key' in s)));
  for (const [name, count] of [['Biceps brachii muscle', 4], ['Triceps brachii muscle', 6], ['Levator ani', 8]]) {
    const target = catalog.targets.find(t => t.source_name === name);
    assert.equal(target.structure_ids.length, count, name);
    assert(target.structure_ids.every(id => muscular.structures.some(s => s.source_id === id)), name);
  }
  const thymus = catalog.targets.find(t => t.source_name === 'Thymus' && t.group_id === 'group:visceral-systems');
  const lymphoid = JSON.parse(await readFile(new URL('lymphoid-organs.json', folder)));
  assert.equal(thymus.structure_ids.length, 2);
  assert(thymus.structure_ids.every(id => lymphoid.structures.some(s => s.source_id === id)));
  const phalanges = catalog.targets.find(t => t.source_name === 'Phalanges of foot');
  const attachments = manifest.models.find(m => m.file === 'muscular-insertions.glb.br');
  assert.equal(phalanges.structure_ids.length, 28);
  assert(!phalanges.structure_ids.some(id => attachments.source_ids.includes(id)), 'Bone assemblies must not include muscle attachment meshes');
  for (const name of ['Thorax', 'Abdomen', 'Pelvis']) {
    const target = catalog.targets.find(t => t.source_name === name);
    const root = catalog.targets.find(t => t.group_id === target.group_id && t.model);
    assert(target.structure_ids.length, name);
    assert(target.structure_ids.some(id => !root.model.structure_ids.includes(id)), name);
    assert(target.structure_ids.every(id => availableIds.has(id)), name);
  }
  const pronator = catalog.targets.find(t => t.source_name === 'Pronator teres');
  assert.equal(pronator.structure_ids.length, 0, 'Do not replace a missing whole muscle with its attachment mesh');
  const bursa = catalog.targets.find(t => t.source_name === 'Synovial bursa');
  assert.equal(bursa.structure_ids.length, 0);
  assert(!('definition_key' in bursa));
});
