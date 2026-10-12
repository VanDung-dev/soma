import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import validator from 'gltf-validator';
const folder = new URL('../public/models/z-anatomy/', import.meta.url);
const catalog = JSON.parse(await readFile(new URL('../../../content/catalog.json', import.meta.url)));
const manifest = JSON.parse(await readFile(new URL('manifest.json', folder)));
const selectionBytes = await readFile(new URL('../../../content/z-anatomy-selections.json', import.meta.url));
const selections = JSON.parse(selectionBytes);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
test('Z-Anatomy preserves geometry, structure identity, definitions and materials', async () => {
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
    assert.deepEqual(record.selection, selections[record.file.replace('.glb', '')]);
    const bytes = await readFile(new URL(record.file, folder));
    const metadataBytes = await readFile(new URL(record.metadata_file, folder));
    assert.equal(bytes.length, record.bytes); assert.equal(hash(bytes), record.sha256);
    assert.equal(metadataBytes.length, record.metadata_bytes); assert.equal(hash(metadataBytes), record.metadata_sha256);
    const report = await validator.validateBytes(new Uint8Array(bytes), { uri: record.file });
    assert.equal(report.issues.numErrors, 0, JSON.stringify(report.issues.messages));
    assert.equal(report.issues.numWarnings, 0, JSON.stringify(report.issues.messages));
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
    const pkg = JSON.parse(metadataBytes), nodes = gltf.nodes.filter(n => n.extras?.source_id);
    assert(gltf.meshes.every(m => m.primitives.every(p => (p.mode ?? 4) === 4)));
    assert.deepEqual(nodes.map(n => n.extras.source_id).sort(), record.source_ids);
    assert.deepEqual(pkg.structures.map(s => s.source_id).sort(), record.source_ids);
    assert.equal(new Set(record.source_ids).size, record.structures);
    assert.equal(Object.keys(pkg.definitions).length, record.definitions);
    const entries = catalog.targets.filter(t => t.group_id === target.group_id);
    assert.equal(entries.length, record.catalog_nodes);
    assert.deepEqual(target.structure_ids, record.source_ids);
    for (const entry of entries) {
      assert(entry.structure_ids.every(id => record.source_ids.includes(id)));
      if (entry.definition_key) assert(pkg.collection_definitions[entry.definition_key]);
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
      if (s.definition_key) assert(pkg.definitions[s.definition_key]);
    }
    for (const d of [...Object.values(pkg.definitions), ...Object.values(pkg.collection_definitions)]) {
      assert.equal(typeof d.text, 'string'); assert(d.text.length);
      assert(d.links.every(link => /^https?:\/\//.test(link)));
    }
    for (const material of gltf.materials) colors.add(JSON.stringify(material.pbrMetallicRoughness?.baseColorFactor));
    assert.equal(gltf.meshes.reduce((n, m) => n + m.primitives.length, 0), record.primitives);
    assert.equal(gltf.meshes.reduce((n, m) => n + m.primitives.reduce((s, p) => s + gltf.accessors[p.indices ?? p.attributes.POSITION].count / 3, 0), 0), record.triangles);
  }
  assert.equal(inventory.size, manifest.unique_structures); assert.equal(inventory.size, 3874);
  assert.equal([...inventory.values()].filter(s => s.definition_key).length, manifest.structures_with_definitions);
  assert.equal(manifest.structures_with_definitions, 2685);
  assert.equal(inventory.size + manifest.excluded_objects.length, 4224);
  assert.equal(manifest.repaired_meshes.length, 29);
  assert(manifest.repaired_meshes.every(m => inventory.has('za:' + hash(m.object).slice(0, 16)) && m.before.vertices > 0 && m.after.polygons > 0));
  assert(colors.size > 10);
  assert(manifest.excluded_objects.every(o => o.object && o.reason));
  const heart = JSON.parse(await readFile(new URL('cardiovascular-system.json', folder)));
  assert(heart.structures.some(s => s.source_name === 'Right atrium' && s.definition_key === 'Right atrium'));
  assert(heart.definitions['Right atrium'].links.some(link => link.includes('wikipedia.org')));
});

test('navigation follows nine source roots and keeps deep, scoped categories', async () => {
  assert.equal(catalog.schema_version, 2);
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
  assert(pkg.collection_definitions[atrium.definition_key].text.length);
  assert(catalog.targets.some(t => t.structure_ids.length === 0 && t.definition_key));
  let maxDepth = 0;
  for (const t of catalog.targets) {
    const seen = new Set(); let entry = t;
    while (entry) { assert(!seen.has(entry.id)); seen.add(entry.id); entry = catalog.targets.find(p => p.id === entry.parent_id); }
    maxDepth = Math.max(maxDepth, seen.size);
  }
  assert.equal(maxDepth, 10);
});
