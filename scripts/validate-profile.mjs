import { readFileSync } from 'node:fs';
import { validateProfile } from '../src/engine.ts';

try {
  const path = new URL('../src/data/profile.json', import.meta.url);
  validateProfile(JSON.parse(readFileSync(path, 'utf8')));
  console.log('Public profile schema and evidence references are valid. Review source content manually.');
} catch (error) {
  console.error('Public profile validation failed:', error instanceof Error ? error.message : 'unknown error');
  process.exitCode = 1;
}
