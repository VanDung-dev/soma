import { bundle } from './model.fixture.mjs';
import { initCatalogWasm } from './catalog.fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

const parseJsonl = text => text.split('\n').filter(Boolean).map(line => JSON.parse(line));

test('bilingual names preserve source identity and have safe, explicit fallbacks', async () => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  try {
    const { anatomy_names, structure_name, target_name } = await initCatalogWasm(server);
    assert.equal(structure_name('Femur', 'left', 'vi'), 'Xương đùi · trái');
    assert.equal(structure_name('Femur', 'left', 'en'), 'Femur · left');
    assert.deepEqual(anatomy_names('An unmapped source'), { vi: 'An unmapped source', en: 'An unmapped source' });
    assert.deepEqual(anatomy_names('constructor'), { vi: 'constructor', en: 'constructor' });
    assert.equal(anatomy_names('Gluteus maximus muscle.e').vi, 'Cơ mông lớn');
    assert.equal(anatomy_names('Optic nerve (II)').vi, 'Thần kinh thị giác (II)');
    assert.equal(target_name('Femur', 'Femur', 'vi'), 'Xương đùi');
    assert.equal(target_name('1: Skeletal system', 'Hệ xương', 'vi'), 'Hệ xương');
    assert.equal(target_name('1: Skeletal system', 'Hệ xương', 'en'), 'Skeletal system');

    const inventory = parseJsonl(await readFile(new URL('../../../content/anatomy-names.jsonl', import.meta.url), 'utf8'));
    const catalog = JSON.parse(await readFile(new URL('../../../content/catalog.json', import.meta.url)));
    const glossary = JSON.parse(await readFile(new URL('../../../content/anatomy-terminology.json', import.meta.url)));
    const sources = new Set([...inventory.map(x => x.name), ...catalog.targets.map(x => x.source_name)]);
    for (const metadata of Object.values(bundle.metadata)) {
      for (const part of metadata.structures) for (const name of part.collections) sources.add(name);
    }
    assert.equal(glossary.schema_version, 1);
    assert.equal(glossary.status, 'draft');
    for (const [source, entry] of Object.entries(glossary.terms)) {
      assert(sources.has(source), `Unknown source: ${source}`);
      assert.equal(typeof entry.vi, 'string');
      assert.equal(typeof entry.en, 'string');
      assert(entry.vi.trim() && entry.en.trim(), source);
      assert.notEqual(entry.vi, entry.en, `Untranslated entry must use the fallback: ${source}`);
    }
    const translated = inventory.filter(x => Object.hasOwn(glossary.terms, x.name))
      .reduce((sum, x) => sum + x.structure_ids.length, 0);
    const total = inventory.reduce((sum, x) => sum + x.structure_ids.length, 0);
    assert(translated / total >= 0.99, 'Vietnamese coverage must retain at least 99% of model structures');
  } finally { await server.close(); }
});
