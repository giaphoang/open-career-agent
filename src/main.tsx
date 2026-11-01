import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import rawProfile from './data/profile.json';
import { advanceInterview, answerQuestion, searchCareer, startInterview, validateProfile, type Answer, type Evidence, type InterviewState } from './engine';
import { enableNativeModel, getNativeModelAvailability, type ModelAvailability, type NativeModel } from './browser-llm';
import type { WasmSearch } from './wasm-search';
import { JobMatchPanel } from './JobMatchPanel';
import { PerformancePanel } from './PerformancePanel';
import { CandidateStudio } from './CandidateStudio';
import './style.css';

const profile = validateProfile(rawProfile);
const prompts = profile.faq.flatMap(entry => entry.questions.slice(0, 1)).slice(0, 3);
type Message = { id: number; question?: string; answer: Answer; label?: string };
type ModelState = ModelAvailability | 'checking' | 'loading' | 'ready' | 'error';

function EvidenceLinks({ evidence }: { evidence: Evidence[] }) {
  if (!evidence.length) return null;
  return <div className="sources"><span>↗ &nbsp; EVIDENCE</span>{evidence.map(item => <a key={item.id} href={item.url} target="_blank" rel="noreferrer">{item.label} <span aria-hidden="true">↗</span></a>)}</div>;
}
function Sources({ ids }: { ids: string[] }) { return <EvidenceLinks evidence={profile.evidence.filter(item => ids.includes(item.id))} />; }
function Avatar({ speaking = false }: { speaking?: boolean }) {
  return <div className={`avatar ${speaking ? 'speaking' : ''}`} aria-hidden="true"><svg viewBox="0 0 100 100" fill="none"><circle cx="50" cy="50" r="50" fill="#d9e9c4"/><path d="M14 100c2-23 16-35 36-35s34 12 36 35" fill="#254e40"/><path d="M31 43c0-20 9-29 20-29 14 0 21 11 20 30l-3 13c-3 10-10 16-18 16s-15-6-18-16z" fill="#dca97d"/><path d="M30 43c-3-18 5-30 19-31 15-2 25 9 22 31-4-3-6-8-7-14-8 6-20 8-33 7z" fill="#29362e"/><g className="eyes" fill="#29362e"><ellipse cx="42" cy="46" rx="2" ry="2.5"/><ellipse cx="59" cy="46" rx="2" ry="2.5"/></g><path className="mouth" d="M45 57q5 4 10 0" stroke="#764d3d" strokeWidth="2" strokeLinecap="round"/></svg></div>;
}
const infoAnswer = (text: string, followUp?: string, evidence: Evidence[] = []): Answer => ({ kind: 'related', text, evidence, ...(followUp ? { followUp } : {}) });

function App() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [decisionTimes, setDecisionTimes] = useState<number[]>([]);
  const [wasmStartupMs, setWasmStartupMs] = useState<number | null>(null);
  const [wasmSearchTimes, setWasmSearchTimes] = useState<number[]>([]);
  const [interview, setInterview] = useState<InterviewState | null>(null);
  const [showSkills, setShowSkills] = useState(false);
  const [showStudio, setShowStudio] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [modelState, setModelState] = useState<ModelState>('checking');
  const [wasmState, setWasmState] = useState<'off' | 'loading' | 'ready' | 'error'>('off');
  const [progress, setProgress] = useState<number | null>(null);
  const [modelSearching, setModelSearching] = useState(false);
  const sequence = useRef(0);
  const model = useRef<NativeModel | WasmSearch | null>(null);
  const provider = useRef<'native' | 'wasm' | null>(null);
  const lifecycle = useRef(new AbortController());
  const startup = useRef<AbortController | null>(null);
  const pending = useRef<AbortController | null>(null);
  const speechTimer = useRef<number | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let mounted = true;
    void getNativeModelAvailability().then(status => { if (mounted) setModelState(status); });
    return () => { mounted = false; lifecycle.current.abort(); startup.current?.abort(); pending.current?.abort(); provider.current = null; model.current?.dispose(); window.clearTimeout(speechTimer.current); };
  }, []);
  function animate() { setSpeaking(true); window.clearTimeout(speechTimer.current); speechTimer.current = window.setTimeout(() => setSpeaking(false), 1200); }
  function add(answer: Answer, question?: string, label?: string) {
    const id = ++sequence.current;
    setMessages(current => [...current, { id, answer, ...(question ? { question } : {}), ...(label ? { label } : {}) }]);
    animate();
    return id;
  }
  function focusChat() { document.getElementById('conversation')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); inputRef.current?.focus({ preventScroll: true }); }
  function beginInterview() {
    pending.current?.abort(); setModelSearching(false);
    const turn = startInterview(); setInterview(turn.state); add(infoAnswer(turn.text, turn.followUp), undefined, 'ROLE DISCOVERY'); focusChat();
  }
  function ask(question: string) {
    const value = question.trim();
    if (!value) return;
    pending.current?.abort(); setModelSearching(false); setInput('');
    if (interview && interview.step !== 'complete') {
      const turn = advanceInterview(interview, value);
      setInterview(turn.state.step === 'complete' ? null : turn.state);
      const matches = turn.state.step === 'complete' ? searchCareer(turn.state.answers.stack ?? '', profile) : null;
      const matchText = matches && (matches.skills.length || matches.projects.length)
        ? ` Related public evidence: ${[...matches.skills.map(item => item.name), ...matches.projects.map(item => item.name)].join(', ')}. This is not a fit assessment.` : '';
      add(infoAnswer(turn.text + matchText, turn.followUp, matches?.evidence ?? []), value, 'ROLE DISCOVERY');
      return;
    }
    const started = performance.now();
    const answer = answerQuestion(value, profile);
    const elapsed = performance.now() - started;
    setDecisionTimes(current => [...current.slice(-199), elapsed]);
    const id = add(answer, value);
    // Native model can suggest only a related authored FAQ; never replace a supported
    // answer or a privacy refusal, and never render generated text as a fact.
    if (answer.kind === 'unknown' && model.current) {
      const controller = new AbortController(); pending.current = controller; setModelSearching(true);
      void model.current.select(value, profile.faq, controller.signal).then(index => {
        if (controller.signal.aborted || index === null) return;
        const entry = profile.faq[index];
        if (!entry) return;
        const evidence = profile.evidence.filter(item => entry.evidenceIds.includes(item.id));
        setMessages(current => current.map(message => message.id === id ? { ...message, answer: infoAnswer(`I can’t verify the specific claim in your question. Related information from the public profile: ${entry.answer}`, entry.followUp, evidence), label: 'RELATED INFORMATION · NOT VERIFIED' } : message));
      }).catch(() => {}).finally(() => { if (pending.current === controller) { pending.current = null; setModelSearching(false); } });
    }
  }
  function findSkill(name: string) {
    const result = searchCareer(name, profile);
    const matches = [...result.skills.map(item => item.name), ...result.projects.map(item => item.name)];
    add(infoAnswer(matches.length ? `Public profile matches: ${matches.join(', ')}. Open the sources to inspect the work.` : 'No matching public evidence was found.', 'What matters most for your role?', result.evidence), `Explore ${name}`, 'EVIDENCE FINDER');
    focusChat();
  }
  function clearChat() { pending.current?.abort(); setModelSearching(false); setMessages([]); setDecisionTimes([]); setInterview(null); setInput(''); inputRef.current?.focus(); }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); ask(input); }
  async function toggleModel() {
    if (provider.current === 'native' && model.current) { pending.current?.abort(); setModelSearching(false); provider.current = null; model.current.dispose(); model.current = null; setModelState(await getNativeModelAvailability()); return; }
    setModelState('loading'); setProgress(null);
    const controller = new AbortController(); startup.current = controller;
    try {
      const next = await enableNativeModel({ signal: controller.signal, onProgress: fraction => { if (!controller.signal.aborted) setProgress(fraction); } });
      if (controller.signal.aborted || lifecycle.current.signal.aborted) { next.dispose(); return; }
      model.current = next; provider.current = 'native'; setModelState('ready');
    } catch { if (!controller.signal.aborted && !lifecycle.current.signal.aborted) setModelState('error'); }
    finally { if (startup.current === controller) startup.current = null; }
  }
  async function toggleWasm() {
    if (provider.current === 'wasm' && model.current) {
      const active = model.current; provider.current = null; pending.current?.abort(); setModelSearching(false); active.dispose(); model.current = null; setWasmState('off'); return;
    }
    setWasmState('loading'); setProgress(null); setWasmStartupMs(null); setWasmSearchTimes([]);
    const controller = new AbortController(); startup.current = controller;
    try {
      const { createWasmSearch } = await import('./wasm-search');
      if (controller.signal.aborted) return;
      const next = await createWasmSearch({ signal: controller.signal, onProgress: fraction => { if (!controller.signal.aborted) setProgress(fraction); }, onTiming: ({ phase, elapsedMs }) => {
        if (controller.signal.aborted || lifecycle.current.signal.aborted) return;
        if (phase === 'startup') setWasmStartupMs(elapsedMs);
        else setWasmSearchTimes(values => [...values.slice(-199), elapsedMs]);
      }, onClosed: () => {
        if (provider.current === 'wasm') { provider.current = null; model.current = null; setWasmState('off'); }
      } });
      if (controller.signal.aborted || lifecycle.current.signal.aborted) { next.dispose(); return; }
      model.current = next; provider.current = 'wasm'; setWasmState('ready');
    } catch { if (!controller.signal.aborted && !lifecycle.current.signal.aborted) setWasmState('error'); }
    finally { if (startup.current === controller) startup.current = null; }
  }
  function cancelLoading() {
    startup.current?.abort(); startup.current = null;
    if (modelState === 'loading') void getNativeModelAvailability().then(setModelState);
    if (wasmState === 'loading') setWasmState('off');
  }
  const modelCanEnable = modelState === 'available' || modelState === 'downloadable' || modelState === 'downloading' || modelState === 'error';
  const modelLabel: Record<ModelState, string> = { checking: 'Checking browser support…', unsupported: 'Not supported in this browser', unavailable: 'Unavailable on this device', available: 'Available on this device', downloadable: 'Model download may be required', downloading: 'Browser is downloading the model', loading: progress === null ? 'Starting the model…' : `Downloading model · ${Math.round(progress * 100)}%`, ready: 'Enabled for related FAQ suggestions', error: 'Could not start; instant chat still works' };
  return <>
    <header className="topbar"><a className="brand" href="#top"><span className="brand-mark">✳</span> OpenCareer<span>Agent</span></a><nav aria-label="Main navigation"><a href="#conversation">Chat</a><a href="#work">Work</a><a href="#experience">Experience</a></nav><a className="top-contact" href={`mailto:${profile.candidate.contact}`}>Get in touch <span>↗</span></a></header>
    <main id="top">
      <section className="hero shell" id="about"><div className="hero-copy"><div className="eyebrow"><span className="status-dot"/> AN INTERACTIVE PORTFOLIO <span className="slash">/</span> OPEN TO CONVERSATION</div><h1>Meet {profile.candidate.name}.<br/><em>Ask about my experience.</em></h1><p>Hiring for a role? Ask about relevant skills, projects, engineering decisions, and results. Every career claim links to public evidence.</p><div className="hero-meta"><span><span className="mini-dot"/> {profile.candidate.availability}</span><span>↳ &nbsp; No account needed</span></div><div className="hero-actions"><button onClick={focusChat}>Ask about my experience <span>↗</span></button><button className="secondary-action" onClick={beginInterview}>Tell me about your role</button></div></div><div className="hero-aside"><span className="aside-number">01 / 03</span><div className="asterisk">✳</div><p>GOOD WORK STARTS<br/>WITH A CONVERSATION.</p></div></section>
      <section className="workspace shell" id="conversation" aria-label="Career conversation">
        <aside className="profile-card"><div className="profile-top"><span className="tiny-label">THE PERSON BEHIND THE WORK</span><span className="spark">✳</span></div><button className="avatar-button" onClick={focusChat} aria-label={`Start a conversation with ${profile.candidate.name}'s career agent`}><span className="profile-avatar"><Avatar speaking={speaking}/><span className="online-dot"/></span><span className="avatar-hint">Say hello ↗</span></button><h2>{profile.candidate.name}</h2><p className="headline">{profile.candidate.headline}</p><Sources ids={profile.candidate.headlineEvidenceIds}/><div className="profile-location">⌖ &nbsp; {profile.candidate.location}</div><div className="profile-divider"/><p className="bio">{profile.candidate.summary}</p><Sources ids={profile.candidate.summaryEvidenceIds}/><div className="profile-divider"/><span className="tiny-label">EXPLORE A SKILL</span><div className="tags skill-buttons">{profile.skills.map(skill => <button type="button" key={skill.name} onClick={() => findSkill(skill.name)}>{skill.name} ↗</button>)}</div><a className="profile-link" href="#work">Explore my work <span>↗</span></a></aside>
        <div className="chat-card"><div className="chat-header"><div><div className="chat-title"><span className="chat-symbol">✳</span> The conversation <span className="live-label"><span/> READY TO CHAT</span></div><p>Ask about experience, projects, or how I work.</p></div><button className="clear-chat" type="button" onClick={clearChat} disabled={!messages.length}>Clear chat</button></div>
          <div className="chat-body" aria-live="polite" aria-relevant="additions text"><div className="message agent-message"><Avatar/><div><div className="message-name">{profile.candidate.name}’s career agent <span>· &nbsp; just now</span></div><div className="bubble">Hi there! 👋 I’m here to help you get to know {profile.candidate.name}’s work. Ask about the experience in this portfolio, or tell me about the role you’re hiring for.<br/><br/>What would you like to explore?</div></div></div>
          {messages.map((message, index) => <div key={message.id} className="exchange">{message.question && <div className="user-bubble">{message.question}</div>}<div className="message agent-message"><Avatar speaking={speaking && index === messages.length - 1}/><div><div className="message-name">Career agent <span>· &nbsp; {message.label ?? 'based on the public profile'}</span></div><div className="bubble">{message.answer.text}{message.answer.followUp && <p className="follow-up">{message.answer.followUp}</p>}<EvidenceLinks evidence={message.answer.evidence}/></div></div></div></div>)}
          {messages.length === 0 && <div className="suggestions"><span>NOT SURE WHERE TO START?</span><div>{prompts.map(prompt => <button type="button" key={prompt} onClick={() => ask(prompt)}>{prompt} <span>↗</span></button>)}</div></div>}{modelSearching && <p className="model-searching" role="status">Looking for related public information on this device…</p>}</div>
          <div className="chat-tools"><button type="button" onClick={beginInterview}>✳ &nbsp; Discuss the role</button><button type="button" onClick={() => setShowSkills(value => !value)} aria-expanded={showSkills} aria-controls="skill-picker">⌕ &nbsp; Find evidence</button>{interview && <button type="button" onClick={() => { setInterview(null); add(infoAnswer('Role questions stopped. Ask anything about the public profile.')); }}>Stop role questions</button>}</div>{showSkills && <div className="skill-picker" id="skill-picker"><span>Choose a skill to see related evidence</span><div>{profile.skills.map(skill => <button key={skill.name} type="button" onClick={() => findSkill(skill.name)}>{skill.name} ↗</button>)}</div></div>}
          <form className="composer" onSubmit={submit}><label className="sr-only" htmlFor="question">{interview ? 'Answer the role question' : 'Ask a question about the portfolio'}</label><input ref={inputRef} id="question" value={input} onChange={event => setInput(event.target.value)} placeholder={interview ? 'Your answer, or type skip…' : 'Ask me anything about my work...'} autoComplete="off" maxLength={2000}/><button type="submit" aria-label="Send question">↑</button></form><div className="chat-foot"><span>✳ &nbsp; Check the sources; role answers stay in this tab.</span><span>NO CHAT SAVED</span></div>
          <JobMatchPanel profile={profile} />
        </div>
      </section>
      <section className="work-section shell" id="work"><div className="section-heading"><div><div className="eyebrow">SELECTED WORK <span className="slash">/</span> THE PROOF IS IN THE PROJECTS</div><h2>Made with intention<span>.</span></h2></div><p>A closer look at the projects, decisions, and details behind the experience.</p></div><div className="project-grid">{profile.projects.map((project, index) => <article className="project-card" key={project.id}><div className="project-head"><span>0{index + 1} &nbsp; / &nbsp; PROJECT</span><span>↗</span></div><div className="project-art" aria-hidden="true"><span>{['◈','◎','▦'][index % 3]}</span></div><div className="project-content"><div className="project-role">{project.role}</div><h3>{project.name}</h3><p>{project.summary}</p><div className="tags">{project.stack.map(item => <button type="button" key={item} onClick={() => findSkill(item)}>{item} ↗</button>)}</div><Sources ids={project.evidenceIds}/></div></article>)}</div></section>
      <section className="experience shell" id="experience"><div><div className="eyebrow">THE JOURNEY <span className="slash">/</span> EXPERIENCE</div><h2>Along the way<span>.</span></h2><p>Every chapter adds something to the work.</p></div><div className="timeline">{profile.timeline.map(item => <article key={`${item.period}-${item.title}`}><span>{item.period}</span><div><h3>{item.title}</h3><p>{item.organization} · {item.detail}</p><Sources ids={item.evidenceIds}/></div></article>)}</div></section>
      <footer className="footer shell" id="developers"><div><span className="brand-mark">✳</span> OpenCareer<span>Agent</span></div><p>Built for better conversations. Powered by public evidence.</p><details className="developer-details"><summary>For developers · Build your own career agent</summary><div className="developer-content"><p>This open-source portfolio runs on GitHub Pages without a required backend or API key. Clone the template or create a starter profile.</p><p><a href="https://github.com/tuannx/open-career-agent" target="_blank" rel="noreferrer">View source and clone on GitHub ↗</a></p><section className="studio-section shell" aria-label="Make your own portfolio"><div className="studio-callout"><div><strong>Making your own portfolio?</strong><p>Turn your public career details into a starter profile.</p></div><button type="button" onClick={() => setShowStudio(value => !value)} aria-expanded={showStudio} aria-controls="studio-container">{showStudio ? 'Close profile builder' : 'Create a profile'} ↗</button></div><div id="studio-container">{showStudio && <CandidateStudio onClose={() => setShowStudio(false)}/>}</div></section><details className="model-panel"><summary>Optional on-device search <span>{modelState === 'ready' || wasmState === 'ready' ? 'ON' : 'OFF'} &nbsp; +</span></summary><div className="model-content"><p>Instant chat works without a model. Experimental search can suggest related prewritten answers; suggestions may be wrong, so check the evidence. Choose one option at a time.</p><strong>Browser language model</strong><p className="model-status" role="status">{modelLabel[modelState]}</p><button type="button" onClick={() => void toggleModel()} disabled={wasmState === 'ready' || wasmState === 'loading' || (!modelCanEnable && modelState !== 'ready')}>{modelState === 'ready' ? 'Turn off model' : 'Enable on-device model'}</button><p>Your browser may download a model after you enable it. Questions are processed by the browser-provided API.</p><strong>WASM semantic search</strong><p className="model-status" role="status">{wasmState === 'loading' ? `Loading model${progress === null ? '…' : ` · ${Math.round(progress * 100)}%`}` : wasmState === 'ready' ? 'Enabled on this device' : wasmState === 'error' ? 'Could not start; instant chat still works' : 'Off'}</p><button type="button" onClick={() => void toggleWasm()} disabled={modelState === 'ready' || modelState === 'loading' || wasmState === 'loading'}>{wasmState === 'ready' ? 'Turn off WASM search' : 'Enable WASM search'}</button><p>Downloads a model (about 23 MB) from Hugging Face plus the WASM runtime from this site or jsDelivr after you enable it. Questions are processed locally in a worker and are not sent to those services by this app.</p>{(modelState === 'loading' || wasmState === 'loading') && <button type="button" onClick={cancelLoading}>Cancel loading</button>}</div></details><PerformancePanel decisionTimes={decisionTimes} wasmStartupMs={wasmStartupMs} wasmSearchTimes={wasmSearchTimes} /></div></details><a href="#top">Back to top ↑</a></footer>
    </main>
  </>;
}

createRoot(document.getElementById('root')!).render(<App/>);
