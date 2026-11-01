import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
const [configuration, jobs = ''] = workflow.split('\njobs:\n');
const [, build = '', deploy = ''] = jobs.split(/(?:^|\n)  (?:build|deploy):\n/);
const mainOnly = "github.ref == 'refs/heads/main' && github.event_name != 'pull_request'";

describe('public GitHub Pages deployment policy', () => {
  it('builds PRs without allowing preview branches to publish public content', () => {
    expect(build).toContain('- run: npm test');
    expect(build).toContain('- run: npm run evaluate');
    expect(build).toContain('- run: npm run build');
    expect(build).toContain(`- if: ${mainOnly}\n        uses: actions/upload-pages-artifact@v3`);
    expect(deploy).toContain(`    if: ${mainOnly}`);
  });

  it('keeps Pages and OIDC write privileges out of all build and PR jobs', () => {
    expect(configuration).toMatch(/permissions:\n  contents: read/);
    expect(configuration).not.toMatch(/(?:pages|id-token): write/);
    expect(build).not.toMatch(/(?:pages|id-token): write/);
    expect(deploy).toMatch(/permissions:\n      pages: write\n      id-token: write/);
  });
});
