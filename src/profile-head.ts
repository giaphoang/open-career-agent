import type { Profile } from './engine';

/**
 * Build-time <head> tags from the public profile: a real page title, a
 * description, link-preview tags (Open Graph and Twitter) and schema.org
 * ProfilePage JSON-LD for search engines. Every value comes from profile.json,
 * which validateProfile has already checked, so nothing here is invented.
 */

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  .replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** JSON inside <script> must not be able to close the tag or open a comment. */
const safeJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c')
  .replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

const isHttpsUrl = (value: string) => {
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
};

/** A description short enough for search results and link previews. */
export function shortDescription(text: string, max = 200): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).replace(/[\s,.;:]+$/, '') + '…';
}

/**
 * Public site URL: an explicit SITE_URL wins; otherwise GitHub Actions'
 * GITHUB_REPOSITORY gives the GitHub Pages address. A user site
 * (owner.github.io) is served from the root, any other repo from /repo/.
 */
export function siteUrlFrom(env: { SITE_URL?: string | undefined; GITHUB_REPOSITORY?: string | undefined }): string | null {
  const explicit = env.SITE_URL?.trim();
  if (explicit) return isHttpsUrl(explicit) ? (explicit.endsWith('/') ? explicit : explicit + '/') : null;
  const match = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/.exec(env.GITHUB_REPOSITORY?.trim() ?? '');
  if (!match) return null;
  const owner = match[1]!.toLowerCase();
  const repo = match[2]!;
  return repo.toLowerCase() === owner + '.github.io' ? `https://${owner}.github.io/` : `https://${owner}.github.io/${repo}/`;
}

export function pageTitle(profile: Profile): string {
  return `${profile.candidate.name} · ${profile.candidate.headline}`;
}

export function profileHeadTags(profile: Profile, siteUrl: string | null): string {
  const { candidate } = profile;
  const title = pageTitle(profile);
  const description = shortDescription(candidate.summary);
  const sameAs = isHttpsUrl(candidate.contact) ? [candidate.contact] : [];
  const person = {
    '@type': 'Person',
    name: candidate.name,
    jobTitle: candidate.headline,
    description: candidate.summary,
    ...(candidate.location ? { homeLocation: { '@type': 'Place', name: candidate.location } } : {}),
    ...(profile.skills.length ? { knowsAbout: profile.skills.map(skill => skill.name) } : {}),
    ...(sameAs.length ? { sameAs } : {}),
    ...(siteUrl ? { url: siteUrl } : {}),
  };
  const jsonLd = { '@context': 'https://schema.org', '@type': 'ProfilePage', ...(siteUrl ? { url: siteUrl } : {}), mainEntity: person };
  const meta = (attr: 'name' | 'property', key: string, content: string) =>
    `<meta ${attr}="${key}" content="${escapeHtml(content)}" />`;
  return [
    siteUrl ? `<link rel="canonical" href="${escapeHtml(siteUrl)}" />` : '',
    meta('property', 'og:type', 'profile'),
    meta('property', 'og:title', title),
    meta('property', 'og:description', description),
    siteUrl ? meta('property', 'og:url', siteUrl) : '',
    meta('name', 'twitter:card', 'summary'),
    meta('name', 'twitter:title', title),
    meta('name', 'twitter:description', description),
    `<script type="application/ld+json">${safeJson(jsonLd)}</script>`,
  ].filter(Boolean).join('\n    ');
}

/** Apply the profile's title, description and head tags to index.html. */
export function applyProfileHead(html: string, profile: Profile, siteUrl: string | null): string {
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(pageTitle(profile))}</title>`)
    .replace(/<meta name="description" content="[^"]*" \/>/,
      `<meta name="description" content="${escapeHtml(shortDescription(profile.candidate.summary))}" />`)
    .replace('</head>', `    ${profileHeadTags(profile, siteUrl)}\n  </head>`);
}
