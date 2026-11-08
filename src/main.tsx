import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import rawProfile from './data/profile.json';
import { advanceInterview, answerQuestion, isFictionalSampleProfile, isPlaceholderEvidenceUrl, searchCareer, startInterview, validateProfile, type Answer, type Evidence, type InterviewState } from './engine';
import { enableNativeModel, getNativeModelAvailability, type ModelAvailability, type NativeModel } from './browser-llm';
import { hasUnsupportedAbsolutePremise, hasUnsupportedQuantifiedPremise } from './quantified-claim';
import type { WasmSearch } from './wasm-search';
import { JobMatchPanel } from './JobMatchPanel';
import { PerformancePanel } from './PerformancePanel';
import { CandidateStudio } from './CandidateStudio';
import { BuiltWith } from './BuiltWith';
import './style.css';
import './print.css';

const profile = validateProfile(rawProfile);
const isDemoProfile = isFictionalSampleProfile(profile.candidate);
// The contact can be a public profile link (e.g. LinkedIn) or an email address.
const contactIsLink = /^https:\/\//i.test(profile.candidate.contact);
const contactHref = contactIsLink ? profile.candidate.contact : `mailto:${profile.candidate.contact}`;
const prompts = profile.faq.flatMap(entry => entry.questions.slice(0, 1)).slice(0, 3);
const setupPrompt = "Build my portfolio using https://github.com/tuannx/open-career-agent. Ask for my CV and public links. Use only approved public facts, don't invent details, test the site, and ask me before publishing.";
type Message = { id: number; question?: string; answer: Answer; label?: string; pending?: boolean; modelStatus?: string };
type ModelState = ModelAvailability | 'checking' | 'loading' | 'ready' | 'error';

function EvidenceLinks({ evidence }: { evidence: Evidence[] }) {
  if (!evidence.length) return null;
  return <div className="sources"><span>↗ &nbsp; EVIDENCE</span>{evidence.map(item => <a key={item.id} href={item.url} target="_blank" rel="noreferrer">{item.label}{isPlaceholderEvidenceUrl(item.url) && ' · DEMO PLACEHOLDER — NOT VERIFIED'} <span aria-hidden="true">↗</span></a>)}</div>;
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
  const [wasmFaqCacheMissMs, setWasmFaqCacheMissMs] = useState<number | null>(null);
  const [wasmFaqCacheHitTimes, setWasmFaqCacheHitTimes] = useState<number[]>([]);
  const [interview, setInterview] = useState<InterviewState | null>(null);
  const [showSkills, setShowSkills] = useState(false);
  const [showStudio, setShowStudio] = useState(false);
  const [promptCopyStatus, setPromptCopyStatus] = useState('');
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
  const availabilityCheck = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const speechTimer = useRef<number | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const setupPromptRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const check = () => { void checkModelAvailability(); };
    const visible = () => { if (document.visibilityState === 'visible') check(); };
    check(); window.addEventListener('focus', check); document.addEventListener('visibilitychange', visible);
    return () => { window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', visible); lifecycle.current.abort(); startup.current?.abort(); pending.current?.abort(); provider.current = null; model.current?.dispose(); window.clearTimeout(speechTimer.current); };
  }, []);
  async function checkModelAvailability() {
    if (startup.current || provider.current === 'native' || lifecycle.current.signal.aborted) return;
    const request = ++availabilityCheck.current;
    const status = await getNativeModelAvailability();
    // Starting a native session invalidates any earlier capability check.
    if (request === availabilityCheck.current && !lifecycle.current.signal.aborted) setModelState(status);
  }
  function animate() { setSpeaking(true); window.clearTimeout(speechTimer.current); speechTimer.current = window.setTimeout(() => setSpeaking(false), 1200); }
  function add(answer: Answer, question?: string, label?: string, pending = false) {
    const id = ++sequence.current;
    setMessages(current => [...current, { id, answer, pending, ...(question ? { question } : {}), ...(label ? { label } : {}) }]);
    animate();
    return id;
  }
  function cancelReply() {
    pending.current?.abort(); pending.current = null; setModelSearching(false);
    setMessages(current => current.map(message => message.pending ? { ...message, pending: false, label: 'PUBLIC PROFILE · CHROME LLM CANCELLED', modelStatus: 'Chrome LLM API reply stopped. Showing the instant profile answer.' } : message));
  }
  function focusChat() {
    // Respect motion-sensitive visitors even when scrolling is triggered by JS.
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    document.getElementById('conversation')?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
    inputRef.current?.focus({ preventScroll: true });
  }
  function beginInterview() {
    cancelReply();
    const turn = startInterview(); setInterview(turn.state); add(infoAnswer(turn.text, turn.followUp), undefined, 'ROLE DISCOVERY'); focusChat();
  }
  function ask(question: string) {
    const value = question.trim();
    if (!value) return;
    cancelReply(); setInput('');
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
    const active = model.current;
    const native = provider.current === 'native' && active && 'reply' in active && answer.kind !== 'private' ? active : null;
    const id = add(answer, value, native ? 'Chrome LLM API · SELECTING' : undefined, Boolean(native));
    if (native) {
      const controller = new AbortController(); pending.current = controller; setModelSearching(true);
      // The adapter bounds and filters this context again. Prior replies are context,
      // never evidence; only the configured public profile can support a new reply.
      const history = messages.flatMap(message => message.question && message.answer.kind !== 'private' && message.label !== 'ROLE DISCOVERY' && !message.pending
        ? [{ question: message.question, answer: message.answer.text }] : []).slice(-3);
      void native.reply(value, profile, history, controller.signal).then(result => {
        if (controller.signal.aborted || pending.current !== controller) return;
        if (result.kind === 'answer') {
          setMessages(current => current.map(message => message.id === id ? { ...message, answer: result.answer, pending: false, label: 'Chrome LLM API · AUTHORED PROFILE · CHECK SOURCES', modelStatus: `On-device model selected authored profile statements in ${(result.elapsedMs / 1000).toFixed(1)} s. ${result.answer.evidence.length ? 'Source links are not independent verification.' : 'No external evidence is attached.'}` } : message));
        } else {
          const reason = result.reason === 'timeout' ? 'took too long' : result.reason === 'unknown' ? 'could not ground a reply in the public profile' : result.reason === 'invalid' ? 'returned a reply that failed the source checks' : result.reason === 'busy' ? 'is busy' : 'could not reply';
          setMessages(current => current.map(message => message.id === id ? { ...message, pending: false, label: 'PUBLIC PROFILE · CHROME LLM FALLBACK', modelStatus: `Chrome LLM API ${reason}. Showing the instant profile answer.` } : message));
        }
      }).catch(() => {
        if (!controller.signal.aborted && pending.current === controller) setMessages(current => current.map(message => message.id === id ? { ...message, pending: false, label: 'PUBLIC PROFILE · CHROME LLM FALLBACK', modelStatus: 'Chrome LLM API could not reply. Showing the instant profile answer.' } : message));
      }).finally(() => { if (pending.current === controller) { pending.current = null; setModelSearching(false); } });
    // WASM remains an optional selector of authored FAQs, not a generative chat.
    } else if (answer.kind === 'unknown' && active && 'select' in active) {
      const controller = new AbortController(); pending.current = controller; setModelSearching(true);
      void active.select(value, profile.faq, controller.signal).then(index => {
        if (controller.signal.aborted || index === null) return;
        const entry = profile.faq[index];
        // A related FAQ cannot corroborate a new headcount, percentage or scale claim.
        if (!entry || hasUnsupportedQuantifiedPremise(value, entry) || hasUnsupportedAbsolutePremise(value, entry)) return;
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
  function clearChat() { cancelReply(); setMessages([]); setDecisionTimes([]); setInterview(null); setInput(''); inputRef.current?.focus(); }
  async function copySetupPrompt() {
    setPromptCopyStatus('');
    try {
      await navigator.clipboard.writeText(setupPrompt);
      setPromptCopyStatus('Copied. Paste it into your AI assistant.');
    } catch {
      setupPromptRef.current?.focus(); setupPromptRef.current?.select();
      setPromptCopyStatus('Copy the selected prompt manually.');
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); ask(input); }
  async function toggleModel() {
    if (startup.current || provider.current === 'wasm') return;
    ++availabilityCheck.current;
    if (provider.current === 'native' && model.current) { cancelReply(); provider.current = null; model.current.dispose(); model.current = null; setModelState('checking'); void checkModelAvailability(); return; }
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
    if (startup.current || provider.current === 'native') return;
    if (provider.current === 'wasm' && model.current) {
      const active = model.current; provider.current = null; pending.current?.abort(); setModelSearching(false); active.dispose(); model.current = null; setWasmState('off'); return;
    }
    setWasmState('loading'); setProgress(null); setWasmStartupMs(null); setWasmSearchTimes([]);
    setWasmFaqCacheMissMs(null); setWasmFaqCacheHitTimes([]);
    const controller = new AbortController(); startup.current = controller;
    try {
      const { createWasmSearch } = await import('./wasm-search');
      if (controller.signal.aborted) return;
      const next = await createWasmSearch({ signal: controller.signal, onProgress: fraction => { if (!controller.signal.aborted) setProgress(fraction); }, onTiming: ({ phase, elapsedMs, faqCacheHit }) => {
        if (controller.signal.aborted || lifecycle.current.signal.aborted) return;
        if (phase === 'startup') setWasmStartupMs(elapsedMs);
        else {
          setWasmSearchTimes(values => [...values.slice(-199), elapsedMs]);
          if (faqCacheHit === false) setWasmFaqCacheMissMs(elapsedMs);
          if (faqCacheHit === true) setWasmFaqCacheHitTimes(values => [...values.slice(-199), elapsedMs]);
        }
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
    if (modelState === 'loading') { setModelState('checking'); void checkModelAvailability(); }
    if (wasmState === 'loading') setWasmState('off');
  }
  const modelCanEnable = modelState === 'available' || modelState === 'downloadable' || modelState === 'downloading' || modelState === 'error';
  const modelLabel: Record<ModelState, string> = { checking: 'Checking Chrome LLM API support…', unsupported: 'Chrome LLM API is not supported in this browser', unavailable: 'Chrome LLM API is unavailable on this device', available: 'Chrome model is downloaded and ready to enable', downloadable: 'Chrome needs to download Gemini Nano before first use', downloading: 'Chrome is downloading its model', loading: progress === null ? 'Starting Chrome LLM API…' : progress < 1 ? `Chrome is downloading Gemini Nano · ${Math.round(progress * 100)}%` : 'Download complete · Chrome is preparing the model…', ready: 'Chrome LLM API enabled for selecting public profile statements', error: 'Could not start Chrome LLM API; instant chat still works' };
  const modelAction: Record<ModelState, string> = { checking: 'Checking model…', unsupported: 'Check again', unavailable: 'Check again', available: 'Enable on-device model', downloadable: 'Download and enable model', downloading: 'Continue model setup', loading: progress === null ? 'Starting model…' : progress < 1 ? 'Downloading model…' : 'Preparing model…', ready: 'Turn off model', error: 'Try model again' };
  const modelSummary = modelState === 'ready' || wasmState === 'ready' ? 'ON'
    : modelState === 'loading' ? progress === null ? 'LOADING' : progress < 1 ? `DOWNLOADING ${Math.round(progress * 100)}%` : 'STARTING'
    : wasmState === 'loading' ? 'LOADING' : modelState === 'downloading' ? 'DOWNLOADING' : 'OFF';
  return <>
    <a className="skip-link" href="#conversation" onClick={event => { event.preventDefault(); focusChat(); }}>Skip to interview chat</a>
    <header className="topbar"><a className="brand" href="#top"><span className="brand-mark">✳</span>{profile.candidate.name}</a><nav aria-label="Main navigation"><a href="#conversation">Interview</a><a href="#work">Projects</a><a href="#experience">Experience</a></nav><a className="top-contact" href={contactHref} {...(contactIsLink ? { target: '_blank', rel: 'noreferrer' } : {})}>Contact candidate <span aria-hidden="true">↗</span></a></header>
    <main id="top">
      <section className="hero shell" id="about">
        <div className="hero-copy">
          <div className="eyebrow"><span className="status-dot"/> MEET THE CANDIDATE <span className="slash">/</span> OPEN TO CONVERSATION</div>
          {isDemoProfile && <p className="demo-banner" role="note"><strong>Demo profile — fictional candidate.</strong> Example source links are placeholders, not verified evidence. Replace all sample claims before sharing with recruiters.</p>}
          <h1>Meet {profile.candidate.name}.<br/><em>Ask about the work.</em></h1>
          <p className="hero-role">{profile.candidate.headline}</p>
          <p>Hiring for a role? Explore my projects, decisions, and experience. Ask a question and review the public evidence behind the answer.</p>
          <div className="hero-meta"><span><span className="mini-dot"/> {profile.candidate.availability}</span><span>↳ &nbsp; No sign-up · No chat history saved</span></div>
          <div className="hero-actions">
            <button type="button" onClick={focusChat} aria-label="Ask about experience">Ask about experience <span aria-hidden="true">↗</span></button>
            <button type="button" className="secondary-action" onClick={beginInterview}>Discuss your open role</button>
          </div>
          {prompts.length > 0 && <button className="hero-example" type="button" onClick={() => { ask(prompts[0] ?? ''); focusChat(); }}>See an example answer with sources <span aria-hidden="true">↗</span></button>}
        </div>
        <div className="hero-aside" aria-hidden="true"><span className="aside-number">01 / 03</span><div className="asterisk">✳</div><p>ASK A QUESTION<br/>REVIEW THE EVIDENCE<br/>EXPLORE THE FIT</p></div>
      </section>
      <section className="workspace shell" id="conversation" aria-label="Career conversation">
        <div className="chat-card"><div className="chat-header"><div><div className="chat-title"><span className="chat-symbol">✳</span> Interview the experience <span className="live-label" role="status"><span/> {modelState === 'ready' ? modelSearching ? 'CHROME LLM · SELECTING' : 'CHROME LLM · READY' : 'READY TO CHAT'}</span></div><p>{modelState === 'ready' ? 'Chrome LLM is on. It selects authored public profile statements; selection is not independent verification. Check the sources.' : 'Ask about projects, responsibilities, decisions, or what this candidate could bring to your team.'}</p></div><button className="clear-chat" type="button" onClick={clearChat} disabled={!messages.length}>Clear chat</button></div>
          <section className="chat-model model-content" aria-label="Chrome LLM API controls">
            <div className="chat-model-heading"><div><strong>Chrome LLM API (Gemini Nano)</strong><p className="model-status" role="status">{modelLabel[modelState]}</p></div><div className="chat-model-actions">
              {modelState === 'unsupported' || modelState === 'unavailable' ? <button type="button" onClick={() => { setModelState('checking'); void checkModelAvailability(); }} disabled={wasmState === 'loading'}>Check again</button> : <button type="button" onClick={() => void toggleModel()} disabled={wasmState === 'ready' || wasmState === 'loading' || (!modelCanEnable && modelState !== 'ready')}>{modelAction[modelState]}</button>}
              {modelState === 'loading' && <button type="button" onClick={cancelLoading}>Cancel loading</button>}
            </div></div>
            {(modelState === 'loading' || modelState === 'downloading') && <progress aria-label="Chrome LLM API model download" max={1} value={modelState === 'loading' && progress !== null ? progress : undefined}/>}
            <p>Optional selection of authored public profile facts on this device. Chrome may need a large model download; Chrome controls its size. Instant chat stays available.</p>
            {(wasmState === 'ready' || wasmState === 'loading') && <p>{wasmState === 'loading' ? 'Cancel WASM loading' : 'Turn off WASM search'} in <a href="#for-developers">optional settings</a> to use Chrome LLM.</p>}
            {modelState === 'loading' && <p>Cancel loading cancels this page's request. Chrome may continue a shared model download.</p>}
            <details className="chat-model-details"><summary>About on-device replies</summary><p>Uses Chrome's built-in Prompt API to draft replies using this public profile and the last three conversation turns. The model can choose unrelated facts; citations are not independent verification. Generated career prose is not displayed. Chat stays in this tab and is not saved by this app. Clear chat to reset its context. Chrome manages the model and download size; this site cannot select a smaller version.</p><p>Open <code>chrome://on-device-internals</code> in Chrome for model details. <a href="https://developer.chrome.com/docs/ai/prompt-api" target="_blank" rel="noreferrer">Chrome LLM API guide ↗</a></p></details>
          </section>
          <div className="chat-body" role="log" aria-label="Career interview conversation" aria-live="polite" aria-relevant="additions text"><div className="message agent-message"><Avatar/><div><div className="message-name">{profile.candidate.name}’s career agent <span>· &nbsp; just now</span></div><div className="bubble">Welcome. I can walk you through {profile.candidate.name}’s public projects, responsibilities, and engineering decisions. You can also tell me about the position you are hiring for.<br/><br/>What would you like to explore?</div></div></div>
          {messages.map((message, index) => <div key={message.id} className="exchange">{message.question && <div className="user-bubble">{message.question}</div>}<div className="message agent-message"><Avatar speaking={speaking && index === messages.length - 1}/><div><div className="message-name">Career agent <span>· &nbsp; {message.label ?? 'based on the public profile'}</span></div><div className="bubble">{message.pending ? <p className="model-searching" role="status">Chrome LLM API is selecting public profile facts…</p> : <>{message.answer.text}{message.answer.followUp && <p className="follow-up">{message.answer.followUp}</p>}<EvidenceLinks evidence={message.answer.evidence}/>{message.modelStatus && <p className="model-reply-status">{message.modelStatus}</p>}</>}</div></div></div></div>)}
          {messages.length === 0 && <div className="suggestions"><span>NOT SURE WHERE TO START?</span><div>{prompts.map(prompt => <button type="button" key={prompt} onClick={() => ask(prompt)}>{prompt} <span>↗</span></button>)}</div></div>}{modelSearching && provider.current !== 'native' && <p className="model-searching" role="status">Looking for related public information on this device…</p>}</div>
          <div className="chat-tools"><button type="button" onClick={beginInterview}>✳ &nbsp; Discuss the role</button><button type="button" onClick={() => setShowSkills(value => !value)} aria-expanded={showSkills} aria-controls="skill-picker">⌕ &nbsp; Find evidence</button>{interview && <button type="button" onClick={() => { setInterview(null); add(infoAnswer('Role questions stopped. Ask anything about the public profile.')); }}>Stop role questions</button>}</div>{showSkills && <div className="skill-picker" id="skill-picker"><span>Choose a skill to see related evidence</span><div>{profile.skills.map(skill => <button key={skill.name} type="button" onClick={() => findSkill(skill.name)}>{skill.name} ↗</button>)}</div></div>}
          <form className="composer" onSubmit={submit}><label className="sr-only" htmlFor="question">{interview ? 'Answer the role question' : 'Ask a question about the portfolio'}</label><input ref={inputRef} id="question" value={input} onChange={event => setInput(event.target.value)} placeholder={interview ? 'Your answer, or type skip…' : 'Ask me anything about my work...'} autoComplete="off" maxLength={2000}/><button type="submit" aria-label="Send question">↑</button></form><div className="chat-foot"><span>✳ &nbsp; Check the sources; role answers stay in this tab.</span><span>NO CHAT SAVED</span></div>
          <JobMatchPanel profile={profile} />
        </div>
        <aside className="profile-card"><div className="profile-top"><span className="tiny-label">THE PERSON BEHIND THE WORK</span><span className="spark">✳</span></div><button className="avatar-button" onClick={focusChat} aria-label={`Start a conversation with ${profile.candidate.name}'s career agent`}><span className="profile-avatar"><Avatar speaking={speaking}/><span className="online-dot"/></span><span className="avatar-hint">Say hello ↗</span></button><h2>{profile.candidate.name}</h2><p className="headline">{profile.candidate.headline}</p><Sources ids={profile.candidate.headlineEvidenceIds}/><div className="profile-location">⌖ &nbsp; {profile.candidate.location}</div><div className="profile-divider"/><p className="bio">{profile.candidate.summary}</p><Sources ids={profile.candidate.summaryEvidenceIds}/><div className="profile-divider"/><span className="tiny-label">EXPLORE A SKILL</span><div className="tags skill-buttons">{profile.skills.map(skill => <button type="button" key={skill.name} onClick={() => findSkill(skill.name)}>{skill.name} ↗</button>)}</div><a className="profile-link" href="#work">Explore my work <span>↗</span></a></aside>
      </section>
      <section className="work-section shell" id="work"><div className="section-heading"><div><div className="eyebrow">SELECTED WORK <span className="slash">/</span> THE PROOF IS IN THE PROJECTS</div><h2>Made with intention<span>.</span></h2></div><p>A closer look at the projects, decisions, and details behind the experience.</p></div><div className="project-grid">{profile.projects.map((project, index) => <article className="project-card" key={project.id}><div className="project-head"><span>0{index + 1} &nbsp; / &nbsp; PROJECT</span><span>↗</span></div><div className="project-art" aria-hidden="true"><span>{['◈','◎','▦'][index % 3]}</span></div><div className="project-content"><div className="project-role">{project.role}</div><h3>{project.name}</h3><p>{project.summary}</p><div className="tags">{project.stack.map(item => <button type="button" key={item} onClick={() => findSkill(item)}>{item} ↗</button>)}</div><Sources ids={project.evidenceIds}/></div></article>)}</div></section>
      <section className="experience shell" id="experience"><div><div className="eyebrow">THE JOURNEY <span className="slash">/</span> EXPERIENCE</div><h2>Along the way<span>.</span></h2><p>Every chapter adds something to the work.</p></div><div className="timeline">{profile.timeline.map(item => <article key={`${item.period}-${item.title}`}><span>{item.period}</span><div><h3>{item.title}</h3><p>{item.organization} · {item.detail}</p><Sources ids={item.evidenceIds}/></div></article>)}</div></section>
      <BuiltWith/>
      <section className="developer-section shell" id="for-developers" aria-label="Create your own portfolio">
        <details className="developer-tools">
          <summary>Make this portfolio your own <span aria-hidden="true">+</span></summary>
          <div className="developer-content">
            <h2>Create your own portfolio</h2>
            <p>Copy this prompt into your AI assistant.</p>
            <div className="setup-prompt"><textarea ref={setupPromptRef} aria-label="Portfolio setup prompt" value={setupPrompt} readOnly rows={4}/><button type="button" onClick={() => void copySetupPrompt()}>Copy prompt</button><p role="status">{promptCopyStatus}</p></div>
            <details className="template-options"><summary>More options</summary>
            <div className="developer-links"><a href="https://github.com/tuannx/open-career-agent/generate" target="_blank" rel="noreferrer">Copy template on GitHub ↗</a><a href="https://github.com/tuannx/open-career-agent/blob/main/docs/add-your-cv.md" target="_blank" rel="noreferrer">Read the setup guide ↗</a></div>
            <section className="studio-section" aria-label="Make your own portfolio"><div className="studio-callout"><div><strong>Making your own portfolio?</strong><p>Turn your public career details into a starter profile.</p></div><button type="button" onClick={() => setShowStudio(value => !value)} aria-expanded={showStudio} aria-controls="studio-container">{showStudio ? 'Close profile builder' : 'Create a profile'} ↗</button></div><div id="studio-container">{showStudio && <CandidateStudio onClose={() => setShowStudio(false)}/>}</div></section>
            <div className="developer-settings">
              <h3>Optional search</h3>
              <details className="model-panel"><summary>Optional on-device AI <span>{modelSummary} &nbsp; +</span></summary><div className="model-content"><p>Chrome LLM replies are controlled in the <a href="#conversation">interview chat above</a>. WASM search suggests related prewritten answers. Both are experimental; check the sources. Choose one option at a time.</p><strong>WASM semantic search</strong><p className="model-status" role="status">{wasmState === 'loading' ? `Loading model${progress === null ? '…' : ` · ${Math.round(progress * 100)}%`}` : wasmState === 'ready' ? 'Enabled on this device' : wasmState === 'error' ? 'Could not start; instant chat still works' : 'Off'}</p><button type="button" onClick={() => void toggleWasm()} disabled={modelState === 'ready' || modelState === 'loading' || wasmState === 'loading'}>{wasmState === 'ready' ? 'Turn off WASM search' : 'Enable WASM search'}</button><p>Downloads a model (about 23 MB) from Hugging Face plus the WASM runtime from this site or jsDelivr after you enable it. Questions are processed locally in a worker and are not sent to those services by this app.</p>{wasmState === 'loading' && <button type="button" onClick={cancelLoading}>Cancel loading</button>}</div></details>
              <h3>Performance details</h3>
              <PerformancePanel decisionTimes={decisionTimes} wasmStartupMs={wasmStartupMs} wasmSearchTimes={wasmSearchTimes} wasmFaqCacheMissMs={wasmFaqCacheMissMs} wasmFaqCacheHitTimes={wasmFaqCacheHitTimes} />
            </div>
            </details>
          </div>
        </details>
      </section>
      <footer className="footer shell"><div><span className="brand-mark">✳</span> {profile.candidate.name}</div><p>Explore the work. Check the evidence. Start a conversation.</p><a href="#top">Back to top ↑</a></footer>
    </main>
  </>;
}

createRoot(document.getElementById('root')!).render(<App/>);

// Precache only the public deterministic app shell. Never persist recruiter input,
// evidence conversations, or remote model weights in the service worker.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js', {
      scope: import.meta.env.BASE_URL,
    }).catch(() => { /* Unsupported or blocked workers retain the online fallback. */ });
  }, { once: true });
}

