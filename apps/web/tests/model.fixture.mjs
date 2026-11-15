import { readFileSync } from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';

export const modelBytes = () => readFileSync(new URL('../public/models/z-anatomy/z-anatomy.glb.br', import.meta.url));
export const bundle = JSON.parse(readFileSync(new URL('../public/models/z-anatomy/z-anatomy.json', import.meta.url), 'utf8'));
let document;
export const modelDocument = () => {
  if (!document) {
    const decoded = brotliDecompressSync(modelBytes());
    document = JSON.parse(decoded.subarray(20, 20 + decoded.readUInt32LE(12)));
  }
  return document;
};
export const modelMetadata = name => bundle.metadata[bundle.manifest.models.find(model => model.metadata_file === `${name}.json`).root_id];
export const metadataPackages = catalog => catalog.targets.filter(target => target.model).map(root => [root, JSON.stringify(bundle.metadata[root.id])]);
