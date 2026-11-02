import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const dist = new URL('../dist/', import.meta.url);
const html = await readFile(new URL('index.html', dist), 'utf8');
// Cache only the build entry script/styles, not third-party models or conversations.
const assets = [...new Set([...html.matchAll(/\b(?:src|href)="([^"]+)"/g)]
  .map(match => match[1])
  .filter(path => /^\.\/assets\/[^"?#]+\.(?:js|css)$/.test(path)))];
if (!assets.some(path => path.endsWith('.js')) || !assets.some(path => path.endsWith('.css'))) {
  throw new Error('Offline shell requires JS and CSS referenced by dist/index.html.');
}
const revision = createHash('sha256').update(html).digest('hex').slice(0, 16);
const template = await readFile(new URL('./offline-worker.template.js', import.meta.url), 'utf8');
const worker = template
  .replace('__OFFLINE_REVISION__', revision)
  .replace('__OFFLINE_ASSETS__', JSON.stringify(['./', ...assets]));
await writeFile(new URL('sw.js', dist), worker);
console.log('Offline shell ' + revision + ': ' + assets.length + ' static assets + index.html');
