import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('Wikipedia reader opens mapped articles and leaves unmapped structures explicit', async () => {
  const references = JSON.parse(await readFile(new URL('../../../content/wikipedia-references.json', import.meta.url)));
  const server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  try {
    const { WikipediaReader, wikipediaReference } = await server.ssrLoadModule('/src/wikipedia-reader.tsx');
    for (const [name, article] of Object.entries(references.articles)) {
      assert.equal(wikipediaReference(name).url, article.url);
      const url = new URL(article.url);
      assert.equal(url.origin, 'https://en.wikipedia.org');
      assert(url.pathname.startsWith('/wiki/') && !url.search);
      assert.equal(article.status, 'source-link');
      assert(!('text' in article));
    }
    const html = renderToStaticMarkup(createElement(WikipediaReader, { name: 'Femur' }));
    assert(html.includes('src="https://en.wikipedia.org/wiki/Femur"'));
    assert(html.includes('title="Bài Wikipedia về Xương đùi"'));
    assert(html.includes('sandbox="allow-scripts allow-same-origin"'));
    assert(html.includes('chưa được đối chiếu độc lập'));
    assert(html.includes('chỉ phục vụ tham khảo'));
    assert.match(html, /<h3>Wikipedia<button[^>]+aria-label="Thông tin về Wikipedia"/);
    assert(html.includes('aria-expanded="false"'));
    assert.match(html, /class="reader-notes" hidden=""/);
    assert(html.includes('<details class="reference-mapping"><summary>Về liên kết tham khảo</summary>'));
    assert(html.includes('target="_blank" rel="noreferrer"'));
    assert(html.indexOf('<iframe') < html.indexOf('class="reader-actions"'));
    assert(html.indexOf('class="reference-notice"') > html.indexOf('class="reader-note"'));
    const missing = renderToStaticMarkup(createElement(WikipediaReader, { name: 'Unmapped <part> & name' }));
    assert(!missing.includes('<iframe'));
    assert(missing.includes('Chưa gắn bài Wikipedia'));
    assert(missing.includes('Unmapped%20%3Cpart%3E%20%26%20name'));
    assert.equal(wikipediaReference('Unmapped <part> & name'), undefined);
    assert.equal(wikipediaReference('constructor'), undefined);
  } finally {
    await server.close();
  }
});
