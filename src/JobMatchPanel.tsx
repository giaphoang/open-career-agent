import { useState, type FormEvent } from 'react';
import { matchJobDescription, type JobMatchResult } from './jd-match';
import type { Profile } from './engine';

/** JD text and results stay in this component's memory. */
export function JobMatchPanel({ profile }: { profile: Profile }) {
  const [input, setInput] = useState('');
  const [result, setResult] = useState<JobMatchResult | null>(null);
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setResult(matchJobDescription(input, profile)); }
  function clear() { setInput(''); setResult(null); }
  return <details className="jd-panel">
    <summary>Explore a job description <span>LOCAL · PRIVATE &nbsp; +</span></summary>
    <div className="jd-content">
      <p>Paste a job description to find skill keywords and their public evidence. This is a navigation aid, not a fit score or proof that a requirement is met. Review each item and source yourself.</p>
      <form onSubmit={submit}>
        <label htmlFor="job-description">Job description</label>
        <textarea id="job-description" value={input} onChange={event => { setInput(event.target.value); setResult(null); }} maxLength={8001} rows={5} placeholder="Paste the role description here…" />
        <div className="jd-actions"><button type="submit">Find related evidence</button><button type="button" onClick={clear}>Clear</button></div>
      </form>
      <p className="jd-privacy">Processed in this tab; not sent to a model or stored by this site. Avoid pasting personal or confidential information.</p>
      <div aria-live="polite">{result?.kind === 'invalid' && <p className="jd-error">{result.message}</p>}
        {result?.kind === 'ok' && <div className="jd-results"><h3>Items to review</h3><p>Keyword overlap does not establish experience level, years, or suitability. Unrecognized items are not evidence of missing skills.</p>{result.requirements.map((item, index) => <article key={index}><p className="jd-snippet">{item.text}</p>{item.status === 'context' ? <p className="jd-review">Review the context manually; this item may include qualifications, preferences or negation.</p> : item.status === 'unrecognized' ? <p className="jd-review">No public keyword identified. Review manually.</p> : <div className="jd-keywords">{item.matches.map(match => <div key={match.term}><strong>{match.term}</strong>{match.projects.length > 0 && <span> · {match.projects.join(', ')}</span>}<ul>{match.evidence.map(source => <li key={source.id}><a href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a></li>)}</ul></div>)}</div>}</article>)}</div>}
      </div>
    </div>
  </details>;
}
