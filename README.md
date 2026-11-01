# OpenCareer Agent

**Your Resume Can Answer Back.** A GitHub Pages template for a public, evidence-backed career portfolio. Recruiters can explore your projects and ask questions; answers come from the facts and evidence you choose to publish. The default experience runs in the browser without an API key or backend.

> The included profile is fictional sample content. Replace it before sharing your site. Publishing a repository or GitHub Pages site makes its contents public.

## Make it yours

1. Create a repository from this template, or fork it. GitHub's **Use this template** button is available when the repository owner has enabled the template setting.
2. Replace the sample in [`src/data/profile.json`](src/data/profile.json) with facts you want to publish. For a guided CV-to-site workflow, including a prompt for a coding assistant, see [Add your CV and update the site](docs/add-your-cv.md).
3. In the repository's **Settings → Pages → Build and deployment**, set **Source** to **GitHub Actions**. Enable Actions if your repository has them disabled.
4. Push your changes to `main`. The [deployment workflow](.github/workflows/deploy.yml) builds and publishes the site. Check the **Actions** tab for its result and the **Pages** settings for the published URL. For a project site it is normally `https://<username>.github.io/<repository>/`.
5. Open the published site, try several questions and links, and share it only after checking the result.

You can edit JSON directly on GitHub with the pencil button; keep valid JSON syntax and preview all changes before committing. To avoid a broken public site, use a branch and test it locally before merging where practical.

The site's **Create a profile** button also offers a local, manual starter builder. It lets you review public details and a supporting source before downloading a `profile.json`; downloading does not update or deploy your repository. The starter has one project and one FAQ and needs more content for a complete portfolio. It does not parse or upload a PDF.

## Run locally

Install Node.js 22.12 or newer and npm, then run:

```sh
npm install
npm run dev
```

Open the local address printed by Vite. For a production build and checks:

```sh
npm test
npm run build
npm run preview
npm run evaluate
```

The preview command serves the production build locally. These commands do not themselves publish a site.

### Labeled synthetic retrieval evaluation

Run `npm run evaluate:corpus` to check 106 **synthetic** questions against the fictional sample profile: 66 labeled FAQ paraphrases, 20 unrelated requests, 10 sensitive requests, and 10 ambiguous requests. CI gates deterministic response safety and repeatability and uploads a per-case JSON report as an Actions artifact. The report includes baseline authored-answer rate on paraphrases and false-related rate on unrelated queries.

The **baseline is not a WASM/LLM relevance benchmark**: it invokes only `answerQuestion`, so non-exact paraphrases may intentionally get a labeled related response or an abstention. A safe response does not prove the referenced public URL supports its text. Labels are provided for future *real-model* calibration, which must report correct FAQ selection, false-related suggestions, ambiguity handling, and browser latency on actual hardware before changing similarity thresholds. Do not interpret the baseline as model accuracy, WebGPU performance, or a speedup.

### Real WASM retrieval evaluation (opt-in)

To measure actual quantized MiniLM inference rather than the deterministic baseline, run the regular build, then launch Chromium with a network connection:

```sh
npm run build
RUN_WASM_EVAL=1 WASM_EVAL_PER_CATEGORY=8 node scripts/browser-smoke.mjs
```

This opens the site's **opt-in on-device WASM search** in Chrome, downloads the pinned model, and exercises labeled synthetic questions against the actual worker via the recruiter UI. It measures startup wall time, per-question UI wall time, which FAQ was suggested, unrelated false suggestions, sensitive-question refusals, and the worker's existing first/cache-hit p50/p95 measurements. Detailed results are written to `artifacts/browser-smoke/wasm-relevance.json`. Increase `WASM_EVAL_PER_CATEGORY` to run more cases (up to 100 per category). All fixture candidate content is fictional; recruiter questions and results stay in the local browser tab. The model/runtime still download from their declared third-party hosts.

For GitHub Actions, put **[WASM benchmark]** in a PR title to enable the extra `wasm-evaluation` job with **all 106 labeled cases** and upload its report. Other PRs retain fast, offline core checks and do not download the model. This job is a **required review signal when opted in**: network/model failures leave the run red; do not mistake an unrun benchmark for a pass.

Interpret results cautiously: a paraphrase might already be handled by deterministic rules, and only `wasmAttempt: true` counts as a model selection. The labeled corpus is synthetic and the sampled subset is not a population benchmark. Chrome desktop CI does not establish iOS/Safari, mobile hardware latency, WebGPU, or third-party evidence truth. Never alter relevance thresholds without inspecting correct-match and false-related rates together.

### Browser smoke evidence

CI runs `node scripts/browser-smoke.mjs` after the production build using installed Chromium/Chrome (Node.js 22+). It asserts recruiter-first content order, collapsed developer tools, accessible labels, no horizontal overflow at 1280px desktop and 390px mobile, and a cited answer while the network is offline **after initial page load**. It also checks the first keyboard stop, a visible skip-to-interview link (44px target), and real Enter-key activation that focuses the recruiter question field. The smoke test exercises real keyboard Enter events for the recruiter CTA, message submission, and developer disclosure; checks visible composer focus and the reduced-motion scroll preference. These are focused keyboard checks, not a full screen-reader audit. It disables WebGPU and never enables optional on-device models. The workflow retains desktop/mobile screenshots and `report.json` as a downloadable Actions artifact, including on failed smoke tests.

This is **not** a full WCAG audit, cold-offline validation, WebGPU benchmark, WASM inference test, or proof that evidence links independently substantiate every claim. Run a manual accessibility review and real-device WASM measurements before declaring production readiness.


The CI install uses `npm ci --ignore-scripts` because this browser-only site does not use the native `onnxruntime-node` binding: its transitive postinstall binary download can fail independently of the web build. CI still runs all tests, the deterministic evaluation, the production build and Chromium smoke. If you add a dependency that requires install scripts, review this policy before changing it.

GitHub Actions tests pull requests and manually dispatched runs on feature branches without publishing them. Only a run targeting `main` may upload or deploy the public GitHub Pages site, and only the deploy job receives Pages/OIDC write permissions.

## Your data

[`src/data/profile.json`](src/data/profile.json) is the source of the displayed profile and answers:

- `candidate`: public identity, headline, summary, location, availability, contact, and evidence IDs for the headline and summary.
- `skills`, `projects`, and `timeline`: the experience you want to show.
- `evidence`: public links with unique IDs and clear labels.
- `faq`: recruiter questions, answers, evidence IDs, and follow-up questions.

Use `candidate.headlineEvidenceIds`, `candidate.summaryEvidenceIds`, and `evidenceIds` in skills, projects, timeline entries and FAQ answers to connect claims to evidence. Each array must contain at least one existing evidence ID. A link supports a claim only when its contents actually substantiate that claim. Keep answers specific and supported; do not infer metrics, dates, responsibilities, or outcomes that your evidence does not establish. The build rejects unknown profile fields and missing references, but cannot detect private information placed in allowed fields or verify a source's contents. See [the CV guide](docs/add-your-cv.md) for a review checklist and migration instructions.

## How answers work

The browser checks configured FAQ questions first, then looks for relevant public profile information. It can decline questions when the data does not support an answer, including some questions about private information. Follow-up questions help the recruiter clarify the role. The role-discovery flow asks about role, stack, scale, and priorities, and can find related public evidence; it does not score suitability. Skill buttons find evidence for the selected skill. The job-description explorer maps recognized public skill and stack keywords to evidence; it does not decide whether a requirement is met. Ambiguous items and unrecognized terms need manual review. Answers, role context, and job descriptions remain in the current page's memory until cleared or the page is closed.

The default experience needs no model download, WebGPU, cloud inference, or paid API. Optional on-device search is experimental and off by default:

- **Browser language model:** uses the experimental browser Prompt API when available. The browser may download its model after the visitor enables it. The model selects from authored FAQs; generated text is never displayed as a career fact.
- **WASM semantic search:** loads an embedding model in a Web Worker after the visitor enables it. Model files are fetched from Hugging Face; the WASM runtime can be fetched from the site or jsDelivr. This is an embedding search, not a generative LLM. The app does not send questions to those services. Downloads disclose network metadata to their hosts. Model caching is disabled by the app; browser and network cache policies are outside its control. The worker embeds each authored FAQ question variant separately (up to five per FAQ), ranks by the best alias within each FAQ, and caches the vectors for subsequent recruiter questions. The ambiguity margin compares distinct FAQs, not aliases of the same FAQ. More aliases cost additional one-time embedding work; verify end-to-end latency and false-related rates before claiming an improvement. A similarity floor and winning-margin heuristic reject weak or ambiguous matches; these cutoffs are not calibrated confidence scores and can miss valid paraphrases. No real-device speedup is claimed until measured.

Either model can suggest unrelated material. Suggestions are labeled as related, not confirmation, and show the original sources. If a model is unavailable or fails, the instant rules-based answer remains. Supported devices and download size depend on the browser and model; validate the experience in your target environment. No analytics or chat persistence is added by default. Hosting providers and browsers can retain operational logs. Voice, automatic PDF import, and independent verification are not included.

`npm run evaluate` exercises configured questions, a private-question control, and an unsupported-question control twice and reports deterministic answer hashes and local Node engine timings. It is not a browser benchmark, a proof of source truth, or a WCAG audit. See the CV guide before publishing content.

The **Performance in this session** panel shows the browser's latest observed LCP candidate, the p95 of up to 200 local rules-engine calls, and (after WASM is enabled) startup wall-clock time plus p50/p95 of up to 200 completed WASM searches. The panel also separates the latest FAQ cache-miss query from repeat queries that reuse precomputed FAQ embeddings, showing cache-hit sample count and p50/p95. Worker messages explicitly report whether FAQ vectors were reused; these timings still do not prove a speedup or factual relevance. WASM search timing includes worker messaging and inference; startup includes worker creation and model loading (possibly cached). It excludes render time, cancellation and timeouts; successful worker responses include legitimate no-match results, while inference errors and unmarked worker results are excluded from latency samples and cannot suggest a FAQ. Measurements remain in page memory; they are not a cross-device benchmark, p75 across visitors, or accessibility audit. Report hardware, browser, network conditions, model download size, and corpus when comparing results.

## Privacy and limitations

Only put information in the repository that you are comfortable publishing, including commit history and linked evidence. Do not add private CV files, phone numbers, addresses, identity documents, confidential client work, credentials, or unapproved employment details. Confirm that linked repositories, demos and contact information are appropriate to share. Removing a secret in a later commit does not erase it from Git history; revoke or rotate exposed credentials.

The project's performance, accessibility and factual-grounding targets are goals, not benchmark results. Test the deployed site on your target devices and audit your own content and links. A citation is not independent verification of an achievement.

## License

MIT. See [LICENSE](LICENSE).
