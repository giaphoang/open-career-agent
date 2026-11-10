# OpenCareer Agent

**Your Resume Can Answer Back.** A GitHub Pages template for a public, evidence-backed career portfolio. Recruiters can explore your projects and ask questions; answers come from the facts and evidence you choose to publish. The default experience runs in the browser without an API key or backend.

> The included profile is fictional sample content. Replace it before sharing your site. Publishing a repository or GitHub Pages site makes its contents public.

## Make it yours

1. Create a repository from this template, or fork it. GitHub's **Use this template** button is available when the repository owner has enabled the template setting.
2. Replace the sample in [`src/data/profile.json`](src/data/profile.json) with facts you want to publish. For a guided CV-to-site workflow, including a prompt for a coding assistant, see [Add your CV and update the site](docs/add-your-cv.md).
3. Push your changes to `main`. The [deployment workflow](.github/workflows/deploy.yml) tests the site and publishes it to the `gh-pages` branch. Enable Actions if your repository has them disabled.
4. After that first run, open **Settings → Pages → Build and deployment**, set **Source** to **Deploy from a branch**, then pick **gh-pages** and **/ (root)**. Check the **Pages** settings for the published URL. For a project site it is normally `https://<username>.github.io/<repository>/`. If a push to `gh-pages` is refused, set **Settings → Actions → General → Workflow permissions** to **Read and write permissions**.
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

### Test on a local Mac

On an Apple Silicon Mac with Node.js 22.12+ and Google Chrome installed in
`/Applications`, run:

```sh
npm ci --ignore-scripts
npm test
npm run evaluate
npm run evaluate:corpus
npm run build
node scripts/browser-smoke.mjs
```

The browser smoke script auto-detects the macOS Chrome app (or use
`CHROME_PATH="/path/to/Chrome" node scripts/browser-smoke.mjs`). It runs
headless Chromium desktop/tablet/mobile viewports, keyboard and accessibility
samples, and an offline deterministic-fallback check. The report with browser,
CPU architecture, and measured UI results is saved to
`artifacts/browser-smoke/report.json`, with screenshots in the same folder.
It uses emulated mobile dimensions, **not a physical iPhone**. Chrome is run
with WebGPU disabled, so this does not validate WebGPU inference or Safari.

With explicit consent to model/runtime downloads, use
`RUN_WASM_EVAL=1 WASM_EVAL_PER_CATEGORY=8 node scripts/browser-smoke.mjs`
for an additional local WASM sample. Results and model transfer appear in
`artifacts/browser-smoke/wasm-relevance.json`. Record the macOS version,
device model, and network conditions outside the report when comparing runs.
The script does not remotely access a Mac or automatically upload local files.

For a repeatable **GitHub-hosted** Apple Silicon check, put
`[macOS smoke]` in a PR title. This enables the opt-in `macos-15` Chrome
build/test/browser job and uploads its evidence; it is **not your local Mac**
and is **not Safari/WebKit**. Test Safari and a physical iPhone separately
before claiming those platforms are supported.

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

The opt-in benchmark now also records `modelNetworkTransfer` at **model-ready time**: Chromium DevTools attaches to the page and its Web Worker and sums non-cached `Network.loadingFinished.encodedDataLength` for completed HTTPS requests, grouped by hostname. It records only hostnames and aggregate byte counts, not URLs, response bodies or question text in network diagnostics; the benchmark fails if no bytes were observed. **One example CI run** ([PR #23, 2026-11-02](https://github.com/tuannx/open-career-agent/actions/runs/41387626487)) observed **28,763,682 encoded bytes across 12 requests** (22,986,232 from `us.aws.cdn.hf.co`, 5,574,281 from `cdn.jsdelivr.net`, 203,169 from `huggingface.co`) on a fresh Chrome Linux CI profile. This is the combined model/runtime **network transfer**, *not* only model weights, not uncompressed size, not representative of warm caches or real phones, and not a speedup result. Network policy, CDN routes and model versions can change these numbers.

For GitHub Actions, put **[WASM benchmark]** in a PR title to enable the extra `wasm-evaluation` job with **all 154 labeled cases** (106 exploratory calibration + 48 new held-out questions) and upload its report. Other PRs retain fast, offline core checks and do not download the model. This job is a **required review signal when opted in**: network/model failures leave the run red; do not mistake an unrun benchmark for a pass. The **full 154-case synthetic run** also enforces a regression budget measured on the last verified baseline: calibration must retain at least 23 correct and at most 7 wrong FAQ selections; the 22 paraphrase holdout must have no wrong selections; unrelated queries must not select a FAQ; ambiguous questions must not display unsupported suggestions; and sensitive requests must be refused without model inference. Smaller local samples report metrics without applying the full-corpus budget. These are CI guardrails, not evidence of production-level accuracy; repeated use of the holdout makes it unsuitable as independent validation.

Interpret results cautiously: a paraphrase might already be handled by deterministic rules, and only `wasmAttempt: true` counts as a model selection. The labeled corpora are synthetic and the sampled subsets are not a population benchmark. Chrome desktop CI does not establish iOS/Safari, mobile hardware latency, WebGPU, or third-party evidence truth. Never alter relevance thresholds without inspecting correct-match and false-related rates together. The optional benchmark also captures **only local top-two cosine scores and FAQ indexes** from successful worker results and replays a threshold grid (cosine floor × winning margin) in the JSON artifact. The grid must reproduce the active threshold's visible FAQ selection counts; a mismatch fails CI. It does not send questions or embeddings to a service and does not add any site analytics. **The exploratory 106-case grid is kept separate from the new 48-case holdout** in `summaryBySplit`, `thresholdGrid` and `holdoutThresholdGrid`. New holdout questions cover 22 FAQ paraphrases, 12 unrelated, 6 sensitive and 8 ambiguous cases and are checked by Vitest for overlap, labels and privacy. They were authored after prior threshold exploration, but any tuning based on their results would contaminate the holdout. The comparison is a first generalization check, not proof of calibrated confidence. Do not change production thresholds based on synthetic tests alone; independent future samples, Safari/mobile hardware and source verification remain open.

### Browser smoke evidence

CI runs `node scripts/browser-smoke.mjs` after the production build using installed Chromium/Chrome (Node.js 22+). It asserts recruiter-first content order, collapsed template setup options, accessible labels, no horizontal overflow at 1280px desktop, 800px tablet, and 390px mobile, and cited deterministic answers during offline interaction **and a fresh offline navigation after one successful online installation**. It also checks the first keyboard stop, a visible skip-to-interview link (44px target), and real Enter-key activation that focuses the recruiter question field. The smoke test exercises real keyboard Enter events for the recruiter CTA, message submission, and template setup disclosure; checks visible composer focus and the reduced-motion scroll preference. These are focused keyboard checks, not a full screen-reader audit. It disables WebGPU and never enables optional on-device models. The workflow retains desktop/tablet/mobile screenshots and `report.json` as a downloadable Actions artifact, including on failed smoke tests. It measures actual column widths: recruiter chat must be wider and left of the profile on desktop/tablet, and first in a single full-width column on mobile.

A targeted WCAG 2.2 [SC 1.4.3 text-contrast](https://www.w3.org/TR/WCAG22/#contrast-minimum) regression check samples **12 recruiter-facing text elements per viewport** (including cited-answer source links after interaction) in real Chromium, resolves the nearest opaque background, and requires **at least 4.5:1** computed contrast and minimum readable font sizes. The per-element foreground, background, font size and measured contrast are saved in `report.json`. The check covers selected solid-color text, **not** overlays, every UI state, screen-reader usability, text resizing, or a comprehensive accessibility audit.

### Offline deterministic app shell

After the **first online production visit**, a versioned service worker precaches only the compiled entry HTML/JS/CSS. The recruiter can reopen the page after going offline and use deterministic, cited answers; no backend, chat history, profile edits, external URLs, or model weights are stored by this worker. Optional WASM/Prompt-API features still require their own browser support and model availability. Offline caching is best-effort: private browsing, blocked service workers, disabled storage, and a first-ever visit while offline are not supported. New deployments are downloaded online; the old complete cache remains a consistent offline fallback until the replacement installs. The production build generates `dist/sw.js` from its hashed assets; `npm run build` is required before browser smoke. Cache names include the service worker's URL path because **CacheStorage is shared across an origin**: updating one GitHub Pages project must not delete a sibling project's offline shell. Older pre-namespace caches cannot be safely attributed to a scope, so they are left for browser storage eviction or manual removal; they contain only previously public HTML/JS/CSS. Inspect the CacheStorage `open-career-shell-*` entries to remove cached public assets manually if desired.

This is **not** a full WCAG audit, first-ever-visit offline validation, WebGPU benchmark, WASM inference test, or proof that evidence links independently substantiate every claim. Run a manual accessibility review and real-device WASM measurements before declaring production readiness.


The CI install uses `npm ci --ignore-scripts` because this browser-only site does not use the native `onnxruntime-node` binding: its transitive postinstall binary download can fail independently of the web build. CI still runs all tests, the deterministic evaluation, the production build and Chromium smoke. If you add a dependency that requires install scripts, review this policy before changing it.

### Pull request previews

Every pull request from a branch of this repository gets its own preview at `https://<username>.github.io/<repository>/pr-preview/pr-<number>/`, and a bot comment on the PR links it. The preview is built only after the same tests, evaluation and browser smoke as `main` pass. It updates on each push and is removed when the PR is merged or closed. Previews are marked `noindex`, their canonical link points at the public site, and the public site's offline worker never serves them. Pull requests from forks are tested but never published, because fork code must not write to your site.

Only a run on `main` updates the public site, at the root of the `gh-pages` branch, and it keeps the `pr-preview/` folder so open previews survive. Only the deploy and preview jobs can write to the repository; build and test jobs are read-only. A preview is public like the site itself, so review a PR's content before pushing it to a branch here.

### Search, share and print

The build writes the candidate's own page title and description, link-preview tags (Open Graph, Twitter card) and schema.org `ProfilePage` JSON-LD into `index.html`, all taken from `src/data/profile.json`. The public address comes from `SITE_URL`, or from `GITHUB_REPOSITORY` in GitHub Actions (`owner/repo` gives `https://owner.github.io/repo/`). Without either, the canonical and `og:url` tags are left out. Printing or saving as PDF gives one clean column with the profile, projects, experience and evidence URLs. A `candidate.contact` that starts with `https://` (for example LinkedIn) opens as a link, and an email address uses `mailto:`.

## Your data

[`src/data/profile.json`](src/data/profile.json) is the source of the displayed profile and answers:

- `candidate`: public identity, headline, summary, location, availability, contact, and evidence IDs for the headline and summary.
- `skills`, `projects`, and `timeline`: the experience you want to show.
- `evidence`: public links with unique IDs and clear labels.
- `faq`: recruiter questions, answers, evidence IDs, and follow-up questions.

Use `candidate.headlineEvidenceIds`, `candidate.summaryEvidenceIds`, and `evidenceIds` in skills, projects, timeline entries and FAQ answers to connect claims to evidence. Each array must contain at least one existing evidence ID. A link supports a claim only when its contents actually substantiate that claim. Keep answers specific and supported; do not infer metrics, dates, responsibilities, or outcomes that your evidence does not establish. The build rejects unknown profile fields and missing references, but cannot detect private information placed in allowed fields or verify a source's contents. See [the CV guide](docs/add-your-cv.md) for a review checklist and migration instructions.

A project can also have an optional `highlights` list: 1 to 8 short lines (240 characters each at most) on how the work was done, such as the method, a guard you added or a measured result. They show as a list under the project summary, print with it, and are offered to the on-device model as separate facts cited with the project's own `evidenceIds`. Keep each line to something the project's evidence supports, and leave out anything you have not confirmed.

## How answers work

With optional models off, the browser checks configured FAQ questions first, then looks for relevant public profile information. It can decline questions when the data does not support an answer, including some questions about private information. Follow-up questions help the recruiter clarify the role. The role-discovery flow asks about role, stack, scale, and priorities, and can find related public evidence; it does not score suitability. Skill buttons find evidence for the selected skill. The job-description explorer maps recognized public skill and stack keywords to evidence; it does not decide whether a requirement is met. Ambiguous items and unrecognized terms need manual review. Answers, role context, and job descriptions remain in the current page's memory until cleared or the page is closed.

The default experience needs no model download, WebGPU, cloud inference, or paid API. Optional on-device conversation and search are experimental and off by default:

- **Chrome LLM API (Gemini Nano):** uses Chrome's built-in [Prompt API](https://developer.chrome.com/docs/ai/prompt-api) when available. Chrome manages the model and download size; this site cannot choose a smaller native model. Controls appear directly below the interview chat heading, without opening template setup options. Availability is checked on page load and when returning to the tab; checking never starts a download or enables a session. The action offers download, enable, continue setup, or retry as appropriate. Progress distinguishes downloading from preparing the model and being enabled; the optional settings summary also reflects the state. Unknown progress stays indeterminate; 100% downloaded does not mean the session is ready. Instant chat stays available throughout. Canceling the page's loading request does not guarantee that Chrome stops a shared model download. Open `chrome://on-device-internals` in Chrome for model details. Once enabled, Chrome selects relevant authored public profile statements for ordinary chat questions, including exact FAQs and follow-ups. **Generated career prose is not displayed**: known fact IDs do not establish that a model-written sentence is true. It receives bounded facts from the public profile and up to three recent conversation turns, excluding recognized private and guided-role turns, not just FAQ choices. Recognized private questions are refused before inference; the explicit guided role-discovery flow remains deterministic. Selected entries carry an **AUTHORED PROFILE · CHECK SOURCES** label. The adapter validates structured output, known fact IDs and narrow numeric/absolute-claim constraints, then renders complete authored entries only; links come only from the displayed entries' configured evidence IDs. Replies without configured evidence links are marked as having no external source. A model can select irrelevant facts; citations do **not** prove that the source URL independently substantiates an authored statement or that a selected entry answers the recruiter's question. Identity/contact fields alone cannot support a career claim. Model-written employers, roles, achievements and negations are never displayed as sourced answers. History is context, not evidence. Errors, invalid output, abstentions and a 45-second deadline retain the instant answer with a visible explanation. A new question, Clear chat or turning the model off cancels pending work; Clear chat resets context. No conversation is saved by the app. Browser language support varies; Vietnamese selection quality is not guaranteed by this integration. This is a source-grounding safety boundary, not independently verified truth or semantic relevance.
- **WASM semantic search:** loads an embedding model in a Web Worker after the visitor enables it. Model files are fetched from Hugging Face; the WASM runtime can be fetched from the site or jsDelivr. This is an embedding search, not a generative LLM. The app does not send questions to those services. Downloads disclose network metadata to their hosts. Model caching is disabled by the app; browser and network cache policies are outside its control. The worker embeds each authored FAQ question variant separately (up to five per FAQ), ranks by the best alias within each FAQ, and caches the vectors for subsequent recruiter questions. The ambiguity margin compares distinct FAQs, not aliases of the same FAQ. More aliases cost additional one-time embedding work; verify end-to-end latency and false-related rates before claiming an improvement. A similarity floor and winning-margin heuristic reject weak or ambiguous matches; these cutoffs are not calibrated confidence scores and can miss valid paraphrases. No real-device speedup is claimed until measured.

WASM can suggest unrelated material. Its suggestions are labeled as related, not confirmation, and show the original sources. To reduce misleading suggestions, a matched FAQ is **not shown** when a recruiter's question asserts a number, percentage, or scale that is absent from that FAQ's authored questions and answer (for example, claiming management of 1,000 developers). Common digit and written forms are compared, including small written quantities such as “two engineers” or “twenty-four teams.” Percentages are compared separately from absolute counts: an authored “90% improvement” does not validate an asserted “90 engineers.” For recognized adjacent count nouns, the same number must also describe the **same unit** in the authored FAQ (for example, 24 engineers does not support an asserted 24 teams; 24 events does not support 24 requests). Plural, written-number, explicit scaled forms (such as “90 thousand developers”), and digit abbreviations (`100k`, `1.5M`, `2B`; case-insensitive) are normalized for this narrow unit check. Short suffixes are treated as quantity magnitudes, not as proof of the claimed action or unit; ambiguous shorthand may be withheld conservatively. A recruiter claim such as “over 90 engineers” or “about 90% availability” must also have an authored comparison of the same type and quantity; an exact “90” alone is not enough. Equivalent phrases such as “more than”/“over” are grouped conservatively, while “at least” remains distinct. Recruiter suffix notation such as `5+ years` or `20K+ users` is treated as an **at least** premise rather than an exact count; the recognized count unit must still match the authored FAQ. Other mathematical notations and comparisons are not comprehensively parsed. This can withhold some valid mathematical implications and **is not** full numerical entailment. A separate conservative check withholds optional FAQ suggestions when the recruiter's question adds absolute qualifiers such as “every,” “all,” “always,” “never,” “permanently,” or “guaranteed” not present in the FAQ. Matching a qualifier does not verify that the claim is true, and ordinary broad requests (such as “all projects”) may be withheld. Unrecognized nouns, indirect descriptions, actions such as “managed” versus “mentored,” negation, and source truth are **not** verified. An isolated “one” remains exempt in requests such as “show one example,” but an explicit “one team” or “one engineer” is now compared against the authored FAQ and count noun. This is a narrow conservative filter, **not** numerical entailment, full unsupported-claim detection, or independent verification. If a model is unavailable or fails, the instant rules-based answer remains. Supported devices and download size depend on the browser and model; validate the experience in your target environment. No analytics or chat persistence is added by default. Hosting providers and browsers can retain operational logs. Voice, automatic PDF import, and independent verification are not included.

`npm run evaluate` exercises configured questions, a private-question control, and an unsupported-question control twice and reports deterministic answer hashes and local Node engine timings. It is not a browser benchmark, a proof of source truth, or a WCAG audit. See the CV guide before publishing content.

Completed Chrome replies show the adapter's elapsed time beside the reply; this is a single observed request, not a throughput or accuracy benchmark. The **Performance in this session** panel shows the browser's latest observed LCP candidate, the p95 of up to 200 local rules-engine calls, and (after WASM is enabled) startup wall-clock time plus p50/p95 of up to 200 completed WASM searches. The panel also separates the latest FAQ cache-miss query from repeat queries that reuse precomputed FAQ embeddings, showing cache-hit sample count and p50/p95. Worker messages explicitly report whether FAQ vectors were reused; these timings still do not prove a speedup or factual relevance. WASM search timing includes worker messaging and inference; startup includes worker creation and model loading (possibly cached). It excludes render time, cancellation and timeouts; successful worker responses include legitimate no-match results, while inference errors and unmarked worker results are excluded from latency samples and cannot suggest a FAQ. Measurements remain in page memory; they are not a cross-device benchmark, p75 across visitors, or accessibility audit. Report hardware, browser, network conditions, model download size, and corpus when comparing results.

## Privacy and limitations

Only put information in the repository that you are comfortable publishing, including commit history and linked evidence. Do not add private CV files, phone numbers, addresses, identity documents, confidential client work, credentials, or unapproved employment details. Confirm that linked repositories, demos and contact information are appropriate to share. Removing a secret in a later commit does not erase it from Git history; revoke or rotate exposed credentials.

The project's performance, accessibility and factual-grounding targets are goals, not benchmark results. Test the deployed site on your target devices and audit your own content and links. A citation is not independent verification of an achievement.

### Demo evidence integrity

The bundled **Alex Morgan** profile is deliberately fictional and uses reserved `example.com` links; the recruiter page identifies this as a demo and marks its source links as **not verified**. These links are not proof of work. When replacing the sample with a real candidate, the profile validator rejects reserved documentation/test hosts (`example.com`, `.org`, `.net`, `.example`, `.test`, `.invalid`, `.localhost`, including subdomains and trailing root dots). Candidate Studio blocks the same hosts before export. Direct IPv4/IPv6 URL hosts are also refused, including loopback and IP-encoded aliases (for example `https://127.0.0.1` or `https://[::1]`); use a public HTTPS domain instead. Use real, public HTTPS evidence links and inspect whether each source supports its linked claim; the application cannot automatically establish the truth of external pages.

## License

MIT. See [LICENSE](LICENSE).
