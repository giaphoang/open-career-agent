import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateProfile } from '../src/engine';
import { applyProfileHead, profileHeadTags, shortDescription, siteUrlFrom } from '../src/profile-head';

const sample = validateProfile(JSON.parse(readFileSync(resolve('tests/fixtures/sample-profile.json'), 'utf8')));
const html = readFileSync(resolve('index.html'), 'utf8');
const jsonLd = (tags: string) => JSON.parse(/<script type="application\/ld\+json">(.*)<\/script>/.exec(tags)![1]!);

describe('profile head tags', () => {
  it('derives the GitHub Pages address for project and user sites', () => {
    expect(siteUrlFrom({ GITHUB_REPOSITORY: 'tuannx/tuannx' })).toBe('https://tuannx.github.io/tuannx/');
    expect(siteUrlFrom({ GITHUB_REPOSITORY: 'Tuannx/tuannx.github.io' })).toBe('https://tuannx.github.io/');
    expect(siteUrlFrom({ SITE_URL: 'https://cv.example.org', GITHUB_REPOSITORY: 'a/b' })).toBe('https://cv.example.org/');
    expect(siteUrlFrom({ SITE_URL: 'http://insecure.example.org' })).toBeNull();
    expect(siteUrlFrom({})).toBeNull();
  });

  it('puts the candidate title, description, previews and ProfilePage JSON-LD in index.html', () => {
    const out = applyProfileHead(html, sample, 'https://owner.github.io/repo/');
    expect(out).toContain(`<title>${sample.candidate.name} · ${sample.candidate.headline}</title>`);
    expect(out).not.toContain('<title>OpenCareer Agent</title>');
    expect(out).toContain('<link rel="canonical" href="https://owner.github.io/repo/" />');
    expect(out).toContain('<meta property="og:url" content="https://owner.github.io/repo/" />');
    expect(out).toContain('<meta name="twitter:card" content="summary" />');
    const data = jsonLd(out);
    expect(data['@type']).toBe('ProfilePage');
    expect(data.mainEntity).toMatchObject({ '@type': 'Person', name: sample.candidate.name, jobTitle: sample.candidate.headline });
    expect(data.mainEntity.knowsAbout).toEqual(sample.skills.map(skill => skill.name));
  });

  it('omits address tags when no public site URL is known', () => {
    const tags = profileHeadTags(sample, null);
    expect(tags).not.toContain('canonical');
    expect(tags).not.toContain('og:url');
    expect(jsonLd(tags).url).toBeUndefined();
  });

  it('cannot be broken out of by profile text', () => {
    const hostile = { ...sample, candidate: { ...sample.candidate, name: 'A</script><script>alert(1)</script>"x', contact: 'https://www.linkedin.com/in/a/' } };
    const tags = profileHeadTags(hostile, null);
    expect(tags).not.toContain('</script><script>');
    expect(tags.match(/<\/script>/g)).toHaveLength(1);
    expect(tags).toContain('&quot;x');
    expect(jsonLd(tags).mainEntity.name).toBe(hostile.candidate.name);
    expect(jsonLd(tags).mainEntity.sameAs).toEqual(['https://www.linkedin.com/in/a/']);
  });

  it('shortens long descriptions at a word boundary', () => {
    const text = 'word '.repeat(80);
    const short = shortDescription(text);
    expect(short.length).toBeLessThanOrEqual(200);
    expect(short.endsWith('word…')).toBe(true);
  });
});
