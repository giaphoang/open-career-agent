import './built-with.css';

/**
 * What this page runs on, in plain words for recruiters and engineers. Each
 * line names a feature that exists in this codebase (file in the comment), so
 * the section never claims more than the template does.
 */
const FEATURES: { name: string; text: string }[] = [
  // src/engine.ts: answerQuestion, sources
  { name: 'Answers with sources', text: 'Every answer is taken from the public profile and links the evidence behind it.' },
  // scripts/generate-offline-shell.mjs, scripts/offline-worker.template.js
  { name: 'Works offline', text: 'A service worker caches only the public app shell, so the page and its cited answers still open without a connection.' },
  // src/browser-llm.ts
  { name: 'On-device AI (optional)', text: 'Chrome’s built-in Prompt API (Gemini Nano) can pick matching profile facts on your device. Nothing is sent to a server.' },
  // src/wasm-worker.ts, src/wasm-search.ts
  { name: 'Semantic search in WebAssembly (optional)', text: 'Transformers.js runs a quantized all-MiniLM-L6-v2 model in a Web Worker to find related questions.' },
  // src/jd-match.ts, src/JobMatchPanel.tsx
  { name: 'Private job match', text: 'Paste a job description and it is matched against the profile inside this tab. It is not uploaded or saved.' },
  // src/profile-head.ts, src/print.css
  { name: 'Search, share and print ready', text: 'schema.org ProfilePage data, link-preview tags and a clean print or PDF layout are built from the same profile file.' },
];

const STACK = 'React 19 · TypeScript · Vite 7 · Transformers.js · GitHub Pages';

export function BuiltWith() {
  return <section className="built-with shell" id="built-with" aria-labelledby="built-with-title">
    <div className="eyebrow">UNDER THE HOOD <span className="slash">/</span> HOW THIS PAGE WORKS</div>
    <h2 id="built-with-title">Built with care<span>.</span></h2>
    <ul className="built-with-list">
      {FEATURES.map(feature => <li key={feature.name}><strong>{feature.name}</strong><p>{feature.text}</p></li>)}
    </ul>
    <p className="built-with-stack">{STACK} · <a href="https://github.com/tuannx/open-career-agent" target="_blank" rel="noreferrer">open-career-agent template ↗</a></p>
  </section>;
}
