import test from 'node:test';
import assert from 'node:assert/strict';
import { glob, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';

test('focus states retain intended indicators without decorative browser rings', async () => {
  const root = new URL('../', import.meta.url);
  const indicators = new Map([
    ['.settings-switch:focus-visible + .camera-mode-switch', { outline: '2px solid var(--accent)', 'outline-offset': '2px' }],
    ['.lesson-library-search:focus-within', { 'border-color': 'var(--accent)', 'box-shadow': '0 0 0 2px var(--selected-bg)' }],
    ['.lesson-library .lesson-card:focus-within, .lesson-library .lesson-card:hover', { 'box-shadow': 'inset 0 0 0 1px var(--line-hover), 0 8px 24px rgba(var(--shadow-rgb), .1)' }],
  ]);
  const seen = new Set();
  for await (const file of glob('src/**/*.css', { cwd: fileURLToPath(root) })) {
    const css = postcss.parse(await readFile(new URL(file, root), 'utf8'));
    css.walkRules(rule => {
      if (!/:focus(?:-visible|-within)?\b/.test(rule.selector)) return;
      if (indicators.has(rule.selector)) {
        const declarations = Object.fromEntries(rule.nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value]));
        assert.deepEqual(Object.fromEntries(Object.keys(indicators.get(rule.selector)).map(property => [property, declarations[property]])), indicators.get(rule.selector));
        seen.add(rule.selector);
        return;
      }
      rule.walkDecls(({ prop, value }) => {
        const ring = prop.startsWith('outline') || prop.startsWith('border') && !prop.endsWith('radius')
          || prop === 'box-shadow' || prop === 'filter';
        if (ring) assert.match(value, /^(none|0(?:px)?)$/, `${file}: ${rule.selector} must not draw a focus ring with ${prop}`);
      });
    });
  }
  assert.deepEqual(seen, new Set(indicators.keys()), 'Custom focus indicators must remain explicit');
});
