import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import rawProfile from './src/data/profile.json';
import { validateProfile } from './src/engine';
import { applyProfileHead, isPreviewBuild, siteUrlFrom } from './src/profile-head';

// Read without Node type definitions so the config type-checks with the app.
const buildEnv = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

// Puts the candidate's own title, description, link-preview tags and
// schema.org JSON-LD into index.html at build time, so crawlers and link
// previews (which don't run JavaScript) see the real profile.
function profileHead(): Plugin {
  return {
    name: 'profile-head',
    transformIndexHtml: (html: string) => applyProfileHead(html, validateProfile(rawProfile), siteUrlFrom(buildEnv),
      { preview: isPreviewBuild(buildEnv) }),
  };
}

export default defineConfig({
  plugins: [react(), profileHead()],
  base: './',
});
