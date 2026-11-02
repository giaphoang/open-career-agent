import { useState, type ChangeEvent } from 'react';
import { isPlaceholderEvidenceUrl, isPrivateQuestion, validateProfile, type Profile } from './engine';

type Draft = {
  name: string; headline: string; location: string; summary: string; availability: string; contact: string;
  sourceLabel: string; sourceUrl: string;
  projectName: string; projectRole: string; projectSummary: string; stack: string;
  question: string; answer: string; followUp: string;
};
type DraftResult = { kind: 'ok'; profile: Profile } | { kind: 'invalid'; message: string };
const emptyDraft: Draft = { name: '', headline: '', location: '', summary: '', availability: '', contact: '', sourceLabel: '', sourceUrl: '', projectName: '', projectRole: '', projectSummary: '', stack: '', question: '', answer: '', followUp: '' };
const fields: (keyof Draft)[][] = [
  ['name', 'headline', 'location', 'summary', 'availability', 'contact'],
  ['sourceLabel', 'sourceUrl', 'projectName', 'projectRole', 'projectSummary', 'stack'],
  ['question', 'answer', 'followUp'],
];
const reviewItems = {
  publication: 'I approve publishing the information in this draft.',
  headline: 'The evidence supports my headline.',
  summary: 'The evidence supports my summary.',
  project: 'The evidence supports the project description and my role.',
  skills: 'The evidence supports each listed skill.',
  faq: 'The evidence supports my FAQ answer.',
};
type ReviewKey = keyof typeof reviewItems;
const emptyReview: Record<ReviewKey, boolean> = { publication: false, headline: false, summary: false, project: false, skills: false, faq: false };
const labels: Record<keyof Draft, string> = {
  name: 'Public name', headline: 'Public professional headline', location: 'Public location', summary: 'Public summary', availability: 'Availability', contact: 'Public contact email',
  sourceLabel: 'Evidence label', sourceUrl: 'Public HTTPS evidence URL', projectName: 'Project name', projectRole: 'Your role on the project', projectSummary: 'Your documented project contribution', stack: 'Project skills or technologies, separated by commas',
  question: 'Recruiter question', answer: 'Evidence-backed answer', followUp: 'Question to ask the recruiter',
};

function checkFields(draft: Draft, stage: number): string | null {
  for (const key of fields[stage] ?? []) {
    const value = draft[key].trim();
    if (!value) return `Please complete: ${labels[key]}.`;
    if (value.length > 2000) return `${labels[key]} must be 2,000 characters or fewer.`;
  }
  if (stage === 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(draft.contact.trim())) return 'Enter a public contact email.';
  if (stage === 1) {
    try {
      const source = new URL(draft.sourceUrl.trim());
      if (source.protocol !== 'https:' || source.username || source.password) return 'Evidence must use an HTTPS URL without credentials.';
      if (isPlaceholderEvidenceUrl(source.href)) return 'Reserved, private-network, example, test, localhost or direct IP-address URLs are not public evidence. Provide a public HTTPS domain source.';
    } catch { return 'Enter a valid public HTTPS evidence URL.'; }
    const skills = draft.stack.split(',').map(item => item.trim()).filter(Boolean);
    if (!skills.length || skills.length > 30 || skills.some(item => item.length > 100)) return 'Enter 1–30 skills, each at most 100 characters.';
  }
  if (stage === 2 && isPrivateQuestion(draft.question)) return 'This question is blocked by the privacy guard. Choose a question about public experience or projects.';
  return null;
}

/** Build only from explicit inputs; no CV parsing or network/storage side effects. */
export function createStarterProfile(draft: Draft): DraftResult {
  for (let stage = 0; stage < fields.length; stage++) {
    const message = checkFields(draft, stage);
    if (message) return { kind: 'invalid', message };
  }
  const seen = new Set<string>();
  const stack = draft.stack.split(',').map(item => item.trim()).filter(item => {
    const key = item.normalize('NFKC').toLocaleLowerCase('en-US');
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  });
  const source = ['source-1'];
  const candidate: Profile = {
    candidate: { name: draft.name.trim(), headline: draft.headline.trim(), headlineEvidenceIds: source, location: draft.location.trim(), summary: draft.summary.trim(), summaryEvidenceIds: source, availability: draft.availability.trim(), contact: draft.contact.trim() },
    evidence: [{ id: 'source-1', label: draft.sourceLabel.trim(), url: draft.sourceUrl.trim() }],
    skills: stack.map(name => ({ name, category: 'Project skills', evidenceIds: source })),
    projects: [{ id: 'project-1', name: draft.projectName.trim(), role: draft.projectRole.trim(), summary: draft.projectSummary.trim(), stack, evidenceIds: source }],
    timeline: [],
    faq: [{ id: 'faq-1', questions: [draft.question.trim()], answer: draft.answer.trim(), followUp: draft.followUp.trim(), evidenceIds: source }],
  };
  try { return { kind: 'ok', profile: validateProfile(candidate) }; }
  catch { return { kind: 'invalid', message: 'The draft is not valid. Review your fields and public evidence link.' }; }
}

export function CandidateStudio({ onClose }: { onClose: () => void }) {
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [stage, setStage] = useState(0);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(emptyReview);
  const [downloaded, setDownloaded] = useState(false);
  const result = createStarterProfile(draft);
  function update(key: keyof Draft) {
    return (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setDraft(current => ({ ...current, [key]: event.target.value }));
      setError(''); setConfirmed(emptyReview); setDownloaded(false);
    };
  }
  function field(key: keyof Draft, multiline = false, type = 'text') {
    const id = `studio-${key}`;
    return <div className="studio-field"><label htmlFor={id}>{labels[key]}</label>{multiline ? <textarea id={id} maxLength={2000} rows={3} value={draft[key]} onChange={update(key)} /> : <input id={id} maxLength={2000} type={type} value={draft[key]} onChange={update(key)} />}</div>;
  }
  function next() {
    const message = checkFields(draft, stage);
    if (message) { setError(message); return; }
    setError(''); setStage(current => current + 1);
  }
  function download() {
    if (result.kind !== 'ok') { setError(result.message); return; }
    if (!Object.values(confirmed).every(Boolean)) { setError('Confirm each evidence check before downloading.'); return; }
    const blob = new Blob([JSON.stringify(result.profile, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = 'profile.json'; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setError(''); setDownloaded(true);
  }
  return <section className="candidate-studio" aria-labelledby="studio-title">
    <style>{`.candidate-studio{max-width:900px;margin:24px auto;padding:24px;border:1px solid #dce8db;border-radius:8px;background:#fff;color:#20392f}.candidate-studio .studio-head{display:flex;justify-content:space-between;gap:16px;align-items:start}.candidate-studio h2{font:400 30px Georgia,serif;margin:8px 0}.candidate-studio h3{font:400 22px Georgia,serif}.candidate-studio p,.candidate-studio li{font-size:13px;line-height:1.6;color:#53685a}.candidate-studio .studio-steps{font-size:11px;font-weight:700;color:#56815c;letter-spacing:.05em}.candidate-studio .studio-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.candidate-studio .studio-field{display:flex;flex-direction:column;gap:6px}.candidate-studio label{font-size:12px;font-weight:700;line-height:1.4}.candidate-studio input:not([type=checkbox]),.candidate-studio textarea{font:inherit;font-size:14px;border:1px solid #cddbcf;border-radius:5px;padding:10px;min-width:0;color:#20392f}.candidate-studio textarea{resize:vertical}.candidate-studio .studio-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:22px}.candidate-studio button{font:inherit;font-size:12px;font-weight:700;cursor:pointer;border:1px solid #315b46;border-radius:5px;padding:10px 14px;background:#315b46;color:#fff}.candidate-studio button.secondary,.candidate-studio .studio-close{background:#fff;color:#315b46}.candidate-studio [role=alert]{color:#a32323;font-weight:700}.candidate-studio pre{max-height:270px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px;background:#f3f7f1;padding:14px;border-radius:5px}.candidate-studio .studio-check{display:flex;align-items:start;gap:9px;margin-top:20px}.candidate-studio input[type=checkbox]{width:18px;height:18px;flex:none}.candidate-studio :focus-visible{outline:3px solid #b2db67;outline-offset:3px}@media(max-width:650px){.candidate-studio{margin:16px;padding:18px}.candidate-studio .studio-grid{grid-template-columns:1fr}}`}</style>
    <div className="studio-head"><div><span className="studio-steps">CANDIDATE STUDIO · {stage + 1} / 4</span><h2 id="studio-title">Create your public profile</h2></div><button type="button" className="studio-close" onClick={onClose}>Close</button></div>
    <p>Use your sanitized CV as a reference and type only information you want to publish. This starter does not read, upload, or save your CV. Closing the studio clears this draft.</p>
    {stage === 0 && <><h3>1. Introduce yourself</h3><p>Choose public details only. Your headline and summary must be supported by the source you add next.</p><div className="studio-grid">{field('name')}{field('headline')}{field('location')}{field('availability')}{field('contact', false, 'email')}{field('summary', true)}</div></>}
    {stage === 1 && <><h3>2. Add a project and evidence</h3><p>Use one public HTTPS link that supports your headline, summary, project, role, and every listed skill. This starter links all claims to this source. If it does not support a claim, leave that claim out and add more sources later.</p><div className="studio-grid">{field('sourceLabel')}{field('sourceUrl', false, 'url')}{field('projectName')}{field('projectRole')}{field('projectSummary', true)}{field('stack')}</div></>}
    {stage === 2 && <><h3>3. Prepare a conversation</h3><p>Write an answer supported by the same public link. The agent will not invent missing facts.</p><div className="studio-grid">{field('question')}{field('answer', true)}{field('followUp')}</div></>}
    {stage === 3 && <><h3>4. Review before downloading</h3><p>Check every field and open the evidence link yourself. This starter includes one project and one question; add more evidence and questions later for a complete portfolio. The link is not automatically verified.</p>{result.kind === 'ok' && <><ul><li>{result.profile.candidate.name} · {result.profile.candidate.headline}</li><li>{result.profile.projects[0]?.name} · {result.profile.projects[0]?.role}</li><li>{result.profile.faq[0]?.questions[0]}</li><li><a href={result.profile.evidence[0]?.url} target="_blank" rel="noreferrer">Open your evidence ↗</a></li></ul><details><summary>Inspect the complete JSON</summary><pre>{JSON.stringify(result.profile, null, 2)}</pre></details>{(Object.entries(reviewItems) as [ReviewKey, string][]).map(([key, label]) => <label className="studio-check" key={key}><input type="checkbox" checked={confirmed[key]} onChange={event => { setConfirmed(current => ({ ...current, [key]: event.target.checked })); setError(''); }}/><span>{label}</span></label>)}</>}</>}
    {error && <p role="alert">{error}</p>}
    {downloaded && <p role="status">Downloaded. Replace <code>src/data/profile.json</code> in your own repository with this file, then test and deploy. Downloading does not update the website.</p>}
    <div className="studio-actions">{stage > 0 && <button type="button" className="secondary" onClick={() => { setStage(current => current - 1); setError(''); }}>Back</button>}{stage < 3 ? <button type="button" onClick={next}>Continue</button> : <button type="button" onClick={download}>Download profile.json</button>}</div>
  </section>;
}
