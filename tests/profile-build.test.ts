import { mkdtempSync, mkdirSync, readFileSync, rmSync, copyFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('fails the build validator for unexpected private fields and accepts a clean profile', () => {
  const directory = mkdtempSync(join(tmpdir(), 'career-profile-test-'));
  try {
    mkdirSync(join(directory, 'src', 'data'), { recursive: true });
    mkdirSync(join(directory, 'scripts'));
    copyFileSync(resolve('src/engine.ts'), join(directory, 'src/engine.ts'));
    copyFileSync(resolve('scripts/validate-profile.mjs'), join(directory, 'scripts/validate-profile.mjs'));
    const profile: unknown = JSON.parse(readFileSync(resolve('tests/fixtures/sample-profile.json'), 'utf8'));
    const dataPath = join(directory, 'src/data/profile.json');
    const run = () => spawnSync(process.execPath, ['--experimental-strip-types', join(directory, 'scripts/validate-profile.mjs')], { encoding: 'utf8' });
    writeFileSync(dataPath, JSON.stringify(profile));
    expect(run().status).toBe(0);
    if (typeof profile !== 'object' || profile === null || Array.isArray(profile)) throw new Error('Invalid fixture');
    writeFileSync(dataPath, JSON.stringify({ ...profile, privateNotes: 'synthetic secret' }));
    const rejected = run();
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain('privateNotes');
    expect(rejected.stderr).not.toContain('synthetic secret');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
