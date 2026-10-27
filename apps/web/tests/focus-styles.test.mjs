import test from 'node:test';
import assert from 'node:assert/strict';
import { glob, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';

test('application focus styles never draw outlines, borders or shadow rings', async () => {
  const root = new URL('../', import.meta.url);
  for await (const file of glob('src/**/*.css', { cwd: fileURLToPath(root) })) {
    const css = postcss.parse(await readFile(new URL(file, root), 'utf8'));
    css.walkRules(rule => {
      if (!/:focus(?:-visible|-within)?\b/.test(rule.selector)) return;
      rule.walkDecls(({ prop, value }) => {
        const ring = prop.startsWith('outline') || prop.startsWith('border') && !prop.endsWith('radius')
          || prop === 'box-shadow' || prop === 'filter';
        if (ring) assert.match(value, /^(none|0(?:px)?)$/, `${file}: ${rule.selector} must not draw a focus ring with ${prop}`);
      });
    });
  }
});
