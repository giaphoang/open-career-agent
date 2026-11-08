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
const sameRepo = 'github.event.pull_request.head.repo.full_name == github.repository';

describe('public GitHub Pages deployment policy', () => {
  it('tests every build and hands only the tested dist folder to publishing jobs', () => {
    const build = job('build');
    expect(build).toContain("if: github.event.action != 'closed'");
    expect(build).toContain('- run: npm test');
    expect(build).toContain('- run: npm run evaluate');
    expect(build).toContain('- run: npm run build');
    expect(build).toContain("PAGES_PREVIEW: ${{ github.event_name == 'pull_request' }}");
    expect(build).toContain('run: node scripts/browser-smoke.mjs');
    expect(build).toContain('name: site-${{ github.run_id }}');
    expect(build.indexOf('scripts/browser-smoke.mjs')).toBeLessThan(build.indexOf('name: site-${{ github.run_id }}'));
  });

  it('publishes the public site from main only, keeping PR previews on the branch', () => {
    const deploy = job('deploy');
    expect(deploy).toContain(`    if: ${mainOnly}`);
    expect(deploy).toContain('needs: build');
    expect(deploy).toContain('uses: JamesIves/github-pages-deploy-action@v4');
    expect(deploy).toContain('branch: gh-pages');
    expect(deploy).toContain('clean-exclude: pr-preview/');
    expect(deploy).toContain('force: false');
  });

  it('previews same-repo PRs under pr-preview/ and removes them when the PR closes', () => {
    const preview = job('preview');
    expect(preview).toContain("github.event_name == 'pull_request' && github.event.action != 'closed'");
    expect(preview).toContain(sameRepo);
    expect(preview).toContain('needs: build');
    expect(preview).toContain('uses: rossjrw/pr-preview-action@v1');
    expect(preview).toContain('umbrella-dir: pr-preview');
    expect(preview).toContain('action: deploy');
    expect(preview).toContain('qr-code: false');
    const cleanup = job('preview-cleanup');
    expect(cleanup).toContain("github.event.action == 'closed'");
    expect(cleanup).toContain(sameRepo);
    expect(cleanup).toContain('action: remove');
    expect(configuration).toContain('types: [opened, reopened, synchronize, closed]');
  });

  it('runs hosted Apple Silicon smoke only when opted in, without write privileges', () => {
    const macos = job('macos-smoke');
    expect(macos).toContain("github.event_name == 'pull_request' && github.event.action != 'closed' && contains(github.event.pull_request.title, '[macOS smoke]')");
    expect(macos).toContain('runs-on: macos-15');
    expect(macos).toContain('run: npm test');
    expect(macos).toContain('run: npm run build');
    expect(macos).toContain('run: node scripts/browser-smoke.mjs');
    expect(macos).toContain('contents: read');
    expect(macos).not.toMatch(/: write/);
  });

  it('gives write access only to the jobs that publish, never to build or test jobs', () => {
    expect(configuration).toMatch(/permissions:\n  contents: read/);
    expect(configuration).not.toMatch(/: write/);
    for (const name of ['build', 'wasm-evaluation', 'macos-smoke']) expect(job(name)).not.toMatch(/: write/);
    expect(job('deploy')).toMatch(/permissions:\n      contents: write\n/);
    for (const name of ['preview', 'preview-cleanup']) {
      expect(job(name)).toMatch(/permissions:\n      contents: write\n      pull-requests: write\n/);
    }
    expect(workflow).not.toMatch(/(?:pages|id-token): write/);
  });

  it('serializes every push to the gh-pages branch', () => {
    for (const name of ['deploy', 'preview', 'preview-cleanup']) {
      expect(job(name)).toMatch(/concurrency:\n      group: gh-pages\n      cancel-in-progress: false/);
    }
  });
});
