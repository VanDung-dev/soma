import { metadataPackages } from './model.fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { createCatalogFixture } from './catalog.fixture.mjs';

test('OpenStax adds attributed related web readings without replacing Wikipedia', async () => {
  const source = JSON.parse(await readFile(new URL('../../../content/catalog.json', import.meta.url)));
  const mappings = JSON.parse(await readFile(new URL('../../../content/openstax-references.json', import.meta.url)));
  const roots = source.targets.filter(target => target.model);
  const packages = metadataPackages(source);
  const parts = packages.flatMap(([, json]) => JSON.parse(json).structures);
  const sourceNames = new Set(source.targets.map(target => target.source_name).concat(parts.flatMap(part => [part.source_name, ...part.collections])));
  for (const mapping of mappings) {
    const url = new URL(mapping.url);
    assert.equal(url.origin, 'https://openstax.org');
    assert(url.pathname.startsWith('/books/anatomy-and-physiology-2e/pages/'));
    assert(!url.search && !url.hash);
    assert(mapping.names.vi && mapping.names.en);
    for (const name of mapping.sources) assert(sourceNames.has(name), name);
  }
  const server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  let store;
  try {
    store = await createCatalogFixture(server, source, packages);
    const { OpenStaxLink, OpenStaxReading } = await server.ssrLoadModule('/src/anatomy/openstax-reference.tsx');
    const { WikipediaReader } = await server.ssrLoadModule('/src/anatomy/wikipedia-reader.tsx');
    const { LanguageProvider } = await server.ssrLoadModule('/src/i18n.tsx');
    for (const [name, section] of [
      ['Parietal bone', '7-2-the-skull'],
      ['Femur', '8-4-bones-of-the-lower-limb'],
      ['Brachial artery', '20-5-circulatory-pathways'],
      ['Anterior branch of obturator nerve', '13-4-the-peripheral-nervous-system'],
    ]) {
      const part = parts.find(part => part.source_name === name);
      assert(store.openstaxReference(part.source_id).url.endsWith('/' + section), name);
    }
    const femur = parts.find(part => part.source_name === 'Femur');
    const reference = store.openstaxReference(femur.source_id);
    assert(!('sources' in reference));
    const html = renderToStaticMarkup(createElement(OpenStaxReading, { reference }));
    assert(!html.includes(reference.url));
    assert(html.startsWith('<a class="openstax-reading"'));
    assert(!html.includes('<p>') && !html.includes('<section'));
    assert(html.includes('Anatomy and Physiology 2e'));
    assert(html.includes('OpenStax, Rice University · 2022'));
    assert(html.includes('https://openstax.org/details/books/anatomy-and-physiology-2e'));
    assert(html.includes('target="_blank" rel="noopener noreferrer"'));
    assert(!html.includes('<iframe'));
    assert.equal(renderToStaticMarkup(createElement(OpenStaxReading)), '');
    assert.equal(store.openstaxReference('unknown'), undefined);
    assert.equal(store.openstaxReference('constructor'), undefined);
    const wikipedia = renderToStaticMarkup(createElement(WikipediaReader, { name: 'Femur', actions: createElement(OpenStaxLink, { reference }) }));
    assert(wikipedia.includes('src="/wikipedia?url='));
    assert(wikipedia.includes('href="https://en.wikipedia.org/wiki/Femur"'));
    assert(wikipedia.includes('<button>Nội dung</button>'));
    assert(wikipedia.includes('rel="noreferrer">Wikipedia</a>'));
    assert(wikipedia.includes(`<a href="${reference.url}"`));
    assert(wikipedia.includes('8.4 · Xương chi dưới'));
    assert(wikipedia.includes('mở trong tab mới'));
    assert(wikipedia.indexOf(reference.url) > wikipedia.indexOf('class="reader-actions"'));
    const compactLink = renderToStaticMarkup(createElement(OpenStaxLink, { reference, compact: true }));
    assert(compactLink.includes('>OpenStax<span'));
    assert(compactLink.includes(`title="${reference.names.vi}"`));
    const compactCredit = renderToStaticMarkup(createElement(OpenStaxReading, { reference, compact: true }));
    assert(compactCredit.includes('>OpenStax</a>'));
    assert(compactCredit.includes('Anatomy and Physiology 2e'));
    assert.equal(renderToStaticMarkup(createElement(OpenStaxLink)), '');
    const originalWindow = globalThis.window;
    try {
      globalThis.window = { localStorage: { getItem: () => 'en' } };
      const english = renderToStaticMarkup(createElement(LanguageProvider, null,
        createElement(OpenStaxReading, { reference }), createElement(OpenStaxLink, { reference })));
      assert(english.includes('8.4 · Bones of the Lower Limb'));
      assert(english.includes('opens in a new tab'));
    } finally {
      if (originalWindow === undefined) delete globalThis.window;
      else globalThis.window = originalWindow;
    }
    store.clearMetadata();
    assert.equal(store.openstaxReference(femur.source_id), undefined);
  } finally {
    store?.free();
    await server.close();
  }
});
