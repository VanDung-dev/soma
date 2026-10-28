import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { createCatalogFixture } from './catalog.fixture.mjs';

test('Rust owns full catalog data, group and word-prefix searches, names, membership and reveal paths', async () => {
  const source = JSON.parse(await readFile(new URL('../../../content/catalog.json', import.meta.url)));
  const terminology = JSON.parse(await readFile(new URL('../../../content/anatomy-terminology.json', import.meta.url)));
  const roots = source.targets.filter(target => target.model);
  const packages = await Promise.all(roots.map(async root => [root, await readFile(new URL('../public/' + root.model.path.replace(/\.glb(?:\.br)?$/, '.json'), import.meta.url), 'utf8')]));
  const names = name => Object.hasOwn(terminology.terms, name) ? terminology.terms[name] : { vi: name, en: name };
  const label = (part, language = 'vi') => names(part.source_name)[language] + (part.laterality === 'left' ? language === 'vi' ? ' · trái' : ' · left' : part.laterality === 'right' ? language === 'vi' ? ' · phải' : ' · right' : '');
  const parts = [...new Map(packages.flatMap(([, json]) => JSON.parse(json).structures).map(part => [part.source_id, part])).values()]
    .sort((a, b) => label(a).localeCompare(label(b), 'vi') || a.source_object.localeCompare(b.source_object));
  const normalize = value => value.toLocaleLowerCase('vi').normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/đ/g, 'd').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const entries = parts.map(part => {
    const translated = names(part.source_name);
    const sides = part.laterality === 'left' ? ['trai', 'left'] : part.laterality === 'right' ? ['phai', 'right'] : [];
    return { id: part.source_id, exact: [part.source_name, translated.vi, translated.en].flatMap(name => {
      const base = normalize(name); return [base, ...sides.map(side => base + ' ' + side)];
    }), text: normalize([label(part), label(part, 'en'), part.source_name, part.latin, part.source_object].join(' ')) };
  });
  const loadedIds = new Set(parts.map(part => part.source_id));
  for (const target of source.targets) {
    if (!(target.model?.structure_ids ?? target.structure_ids).some(id => loadedIds.has(id))) continue;
    const translated = names(target.source_name);
    const exact = [target.source_name, target.title !== target.source_name ? target.title : translated.vi, translated.en].map(normalize);
    entries.push({ id: target.id, exact, text: exact.join(' ') });
  }
  const referenceSearch = query => {
    const text = normalize(query), exact = [], other = [];
    if (!text) return [];
    for (const entry of entries) if (text.split(/\s+/).every(word => (' ' + entry.text).includes(' ' + word))) (entry.exact.includes(text) ? exact : other).push(entry.id);
    return exact.concat(other);
  };
  const server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  let store;
  try {
    store = await createCatalogFixture(server, source, packages);
    assert.deepEqual(store.roots.map(root => root.id), roots.map(root => root.id));
    assert.deepEqual(store.identities(), parts.map(part => part.source_id));
    for (const part of parts) {
      const { names: translated, collection_names, ...original } = store.detail(part.source_id);
      assert.deepEqual(original, part);
      assert.deepEqual(translated, { vi: label(part), en: label(part, 'en') });
    }
    const queries = new Set(['---', 'ĐỘNG MẠCH', 'Femur left', 'xuong dui trai', 'Os femoris', '🦴', 'e\u0301', 'İ', 'ΟΣ', '不存在',
      ...parts.flatMap(part => [part.source_name, part.latin]).filter(Boolean)]);
    for (const query of queries) {
      const actual = store.search(query, 'vi', parts.length + source.targets.length);
      const expected = referenceSearch(query);
      assert.deepEqual(actual.items.map(part => part.source_id ?? part.id), expected, query);
      assert.equal(actual.total, expected.length, query);
      assert.deepEqual(store.search(query, 'vi', 20).items.map(part => part.source_id ?? part.id), expected.slice(0, 20), query);
    }
    for (const language of ['vi', 'en']) {
      const collator = new Intl.Collator(language, { sensitivity: 'base', numeric: true, ignorePunctuation: true });
      const alphabetical = [...parts].sort((a, b) => Number(/\p{L}/u.test(label(b, language))) - Number(/\p{L}/u.test(label(a, language))) || collator.compare(label(a, language), label(b, language)));
      assert.deepEqual(store.search('', language, parts.length).items.map(part => part.source_id), alphabetical.map(part => part.source_id));
    }
    const byId = new Map(source.targets.map(target => [target.id, target]));
    const skull = source.targets.find(target => target.source_name === 'Cranium');
    for (const query of ['sọ', 'SỌ', 'so', 'Cranium']) {
      for (const language of ['vi', 'en']) {
        const first = store.search(query, language, 20).items[0];
        assert.equal(first.id, skull.id, query);
        assert.equal(first.names.vi, 'Sọ');
        assert.equal(first.count, 54);
      }
    }
    const skullResults = store.search('sọ', 'vi', 10000);
    assert(!skullResults.items.some(row => row.source_id === 'za:a250b6a53af7f133'), 'Do not match so inside extensors');
    assert(skullResults.items.some(row => row.names.vi === 'Cân trên sọ · trái'), 'Keep structure name matches');
    assert(!skullResults.items.some(row => row.count === 0), 'Exclude groups without linked models');
    assert.deepEqual(store.reveal(skull.id).map(([id]) => id), [skull.id, skull.parent_id]);
    const children = new Map(source.targets.map(target => [target.id, source.targets.filter(child => child.parent_id === target.id)]));
    const members = target => target.model?.structure_ids ?? target.structure_ids;
    for (const target of source.targets) assert.deepEqual(store.members(target.id), members(target));
    for (const part of parts) {
      const path = [];
      let target = source.targets.find(target => members(target).includes(part.source_id) && !children.get(target.id).some(child => child.structure_ids.includes(part.source_id)));
      while (target) { path.push(target.id); target = byId.get(target.parent_id); }
      assert.deepEqual(store.reveal(part.source_id).map(([id]) => id), path, part.source_id);
    }
    assert.equal(store.target('unknown'), undefined);
    assert.deepEqual(store.reveal('unknown'), []);
    console.log(JSON.stringify({ queries: queries.size, structures: parts.length, targets: source.targets.length }));
  } finally { store?.free(); await server.close(); }
});
