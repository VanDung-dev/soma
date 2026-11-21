import { execFileSync } from 'node:child_process';

const metadata = JSON.parse(execFileSync('cargo', ['metadata', '--no-deps', '--format-version', '1', '--locked'], {
  cwd: new URL('../', import.meta.url),
  encoding: 'utf8',
}));
const app = metadata.packages.find(pkg => pkg.name === 'soma');
if (!app) throw new Error('Soma package is missing from the Cargo workspace');
console.log(app.version);
