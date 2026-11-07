import { readFileSync } from 'node:fs';
import { initSync } from '../src/content/content.js';

initSync({ module: readFileSync(new URL('../src/content/content_bg.wasm', import.meta.url)) });
export * from '../src/content/content.js';
