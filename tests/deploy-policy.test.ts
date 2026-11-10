import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
const [configuration, jobs = ''] = workflow.split('\njobs:\n');
/** Each top-level job's text, keyed by job id. */
const job = (name: string) => {
  const parts = ('\n' + jobs).split(/\n  (?=[a-z-]+:\n)/);
  return parts.find(part => part.startsWith(name + ':\n')) ?? '';
};
const mainOnly = "github.ref == 'refs/heads/main' && github.event_name != 'pull_request'";

describe('public GitHub Pages deployment policy', () => {
  it('tests the build before uploading the Pages artifact', () => {
    const build = job('build');
    expect(build).toContain('- run: npm test');
    expect(build).toContain('- run: npm run evaluate');
    expect(build).toContain('- run: npm run evaluate:corpus');
    expect(build).toContain('- run: npm run build');
    expect(build).toContain('run: node scripts/browser-smoke.mjs');
    expect(build).toContain('uses: actions/upload-pages-artifact@v3');
    expect(build.indexOf('scripts/browser-smoke.mjs')).toBeLessThan(build.indexOf('uses: actions/upload-pages-artifact@v3'));
    expect(build).toContain('path: dist');
  });

  it('publishes the public site from main only through GitHub Pages', () => {
    const deploy = job('deploy');
    expect(deploy).toContain(`    if: ${mainOnly}`);
    expect(deploy).toContain('needs: build');
    expect(deploy).toContain('pages: write');
    expect(deploy).toContain('id-token: write');
    expect(deploy).toContain('uses: actions/deploy-pages@v4');
    expect(deploy).toContain('id: deployment');
  });

  it('runs hosted Apple Silicon smoke only when opted in, without write privileges', () => {
    const macos = job('macos-smoke');
    expect(macos).toContain("github.event_name == 'pull_request' && contains(github.event.pull_request.title, '[macOS smoke]')");
    expect(macos).toContain('runs-on: macos-15');
    expect(macos).toContain('run: npm test');
    expect(macos).toContain('run: npm run build');
    expect(macos).toContain('run: node scripts/browser-smoke.mjs');
    expect(macos).toContain('contents: read');
    expect(macos).not.toMatch(/: write/);
  });

  it('gives write access only to the Pages deployment job', () => {
    expect(configuration).toMatch(/permissions:\n  contents: read/);
    for (const name of ['build', 'wasm-evaluation', 'macos-smoke']) {
      expect(job(name)).not.toMatch(/: write/);
    }
    expect(job('deploy')).toContain('pages: write');
    expect(job('deploy')).toContain('id-token: write');
    expect(job('deploy')).not.toContain('contents: write');
  });

  it('serializes deployments by ref', () => {
    expect(configuration).toContain('group: pages-${{ github.ref }}');
    expect(configuration).toContain('cancel-in-progress: false');
  });
});
