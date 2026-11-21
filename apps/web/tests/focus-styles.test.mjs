import test from 'node:test';
import assert from 'node:assert/strict';
import { glob, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';

test('focus states retain intended indicators without decorative browser rings', async () => {
  const root = new URL('../', import.meta.url);
  const indicators = new Map([
    ['.settings-switch:focus-visible + .camera-mode-switch', { background: 'var(--selected-bg)' }],
    ['.lesson-library-search:has(input:focus-visible)', { 'background-color': 'var(--selected-bg)' }],
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
