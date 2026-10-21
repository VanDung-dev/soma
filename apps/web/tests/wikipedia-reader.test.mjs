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
    const { WikipediaReader, wikipediaReference } = await server.ssrLoadModule('/src/anatomy/wikipedia-reader.tsx');
    for (const [name, article] of Object.entries(references.articles)) {
      assert.equal(wikipediaReference(name).url, article.url);
      const url = new URL(article.url);
      assert.equal(url.origin, 'https://en.wikipedia.org');
      assert(url.pathname.startsWith('/wiki/') && !url.search);
      assert.equal(article.status, 'source-link');
      assert(!('text' in article));
    }
    const html = renderToStaticMarkup(createElement(WikipediaReader, { name: 'Femur' }));
    assert(html.includes('<iframe'));
    assert(html.includes('class="wikipedia-article"'));
    assert(html.includes('href="https://en.wikipedia.org/wiki/Femur"'));
    const skeleton = renderToStaticMarkup(createElement(WikipediaReader, { name: '1: Skeletal system' }));
    assert(skeleton.includes('href="https://en.wikipedia.org/wiki/Skeleton#Humans"'));
    assert(html.includes('title="Bài Wikipedia về Xương đùi"'));
    assert(html.includes('src="/wikipedia?url=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FFemur"'));
    assert(html.includes('sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"'));
    assert(!html.includes('allow-same-origin') && !html.includes('reader-navigation'));
    assert(html.includes('aria-busy="true"'));
    assert(html.includes('class="wikipedia-skeleton" role="status"'));
    assert(html.includes('Đang tải Wikipedia…'));
    const disclaimer = 'Wikipedia chỉ phục vụ tham khảo và học tập; thông tin có thể sai hoặc chưa cập nhật, không thay thế tài liệu chuyên môn hoặc tư vấn y tế.';
    assert(html.includes(disclaimer));
    assert(!html.includes('<h3>Wikipedia</h3>'));
    assert(!html.includes('reader-info'));
    assert(html.includes(`<div class="reference-mapping-description"><p class="reference-notice">${disclaimer}</p></div>`));
    assert(html.includes('<details class="reference-mapping"><summary>Lưu ý về tài liệu tham khảo</summary>'));
    assert(html.includes('target="_blank" rel="noreferrer"'));
    assert(html.indexOf('class="wikipedia-article"') < html.indexOf('class="reader-actions"'));
    const missing = renderToStaticMarkup(createElement(WikipediaReader, { name: 'Unmapped <part> & name' }));
    assert(!missing.includes('<iframe'));
    assert(!missing.includes('wikipedia-skeleton'));
    assert(missing.includes('Chưa gắn bài Wikipedia'));
    assert(missing.includes('Unmapped%20%3Cpart%3E%20%26%20name'));
    assert(missing.includes(disclaimer));
    assert.equal(wikipediaReference('Unmapped <part> & name'), undefined);
    assert.equal(wikipediaReference('constructor'), undefined);
  } finally {
    await server.close();
  }
});
