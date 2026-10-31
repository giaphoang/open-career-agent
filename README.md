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

## Run locally

Install Node.js 22 and npm, then run:

```sh
npm install
npm run dev
```

Open the local address printed by Vite. For a production build and checks:

```sh
npm test
npm run build
npm run preview
```

The preview command serves the production build locally. These commands do not themselves publish a site.

## Your data

[`src/data/profile.json`](src/data/profile.json) is the source of the displayed profile and answers:

- `candidate`: public identity, headline, summary, location, availability, and contact.
- `skills`, `projects`, and `timeline`: the experience you want to show.
- `evidence`: public links with unique IDs and clear labels.
- `faq`: recruiter questions, answers, evidence IDs, and follow-up questions.

Use the same `evidenceIds` in skills, projects, timeline entries and FAQ answers to connect claims to evidence. A link supports a claim only when its contents actually substantiate that claim. Keep answers specific and supported; do not infer metrics, dates, responsibilities, or outcomes that your evidence does not establish. See [the CV guide](docs/add-your-cv.md) for a review checklist and examples.

## How answers work

The browser checks configured FAQ questions first, then looks for relevant public profile information. It can decline questions when the data does not support an answer, including questions about private information. Follow-up questions help the recruiter clarify the role. This is a bounded, rules-based experience, not an autonomous recruiter or a verification service. Phrase important questions explicitly in the FAQ and test them; free-form retrieval may miss a relevant answer or return only related information.

The default configuration does not require WebGPU, a model download, cloud inference, or a paid API. It does not save chat or add analytics by default. Hosting providers and browsers can still retain their own operational logs; review their policies for your use case. Optional browser LLM, voice, PDF import, and automated verification are not included in the default template.

## Privacy and limitations

Only put information in the repository that you are comfortable publishing, including commit history and linked evidence. Do not add private CV files, phone numbers, addresses, identity documents, confidential client work, credentials, or unapproved employment details. Confirm that linked repositories, demos and contact information are appropriate to share. Removing a secret in a later commit does not erase it from Git history; revoke or rotate exposed credentials.

The project's performance, accessibility and factual-grounding targets are goals, not benchmark results. Test the deployed site on your target devices and audit your own content and links. A citation is not independent verification of an achievement.

## License

MIT. See [LICENSE](LICENSE).
