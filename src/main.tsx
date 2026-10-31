import { useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import rawProfile from './data/profile.json';
import { answerQuestion, validateProfile, type Answer, type Evidence } from './engine';
import './style.css';

const profile = validateProfile(rawProfile);
const prompts = profile.faq.flatMap(entry => entry.questions.slice(0, 1)).slice(0, 3);
type Message = { question: string; answer: Answer };

function Sources({ ids }: { ids: string[] }) {
  const sources = ids.flatMap(id => profile.evidence.filter(item => item.id === id));
  return <EvidenceLinks evidence={sources} />;
}

function EvidenceLinks({ evidence }: { evidence: Evidence[] }) {
  if (!evidence.length) return null;
  return <div className="sources"><span>↗ &nbsp; EVIDENCE</span>{evidence.map(item => <a key={item.id} href={item.url} target="_blank" rel="noreferrer">{item.label} <span aria-hidden="true">↗</span></a>)}</div>;
}

function Avatar({ speaking = false }: { speaking?: boolean }) {
  return <div className={`avatar ${speaking ? 'speaking' : ''}`} aria-hidden="true"><svg viewBox="0 0 100 100" fill="none"><circle cx="50" cy="50" r="50" fill="#d9e9c4"/><path d="M14 100c2-23 16-35 36-35s34 12 36 35" fill="#254e40"/><path d="M31 43c0-20 9-29 20-29 14 0 21 11 20 30l-3 13c-3 10-10 16-18 16s-15-6-18-16z" fill="#dca97d"/><path d="M30 43c-3-18 5-30 19-31 15-2 25 9 22 31-4-3-6-8-7-14-8 6-20 8-33 7z" fill="#29362e"/><g className="eyes" fill="#29362e"><ellipse cx="42" cy="46" rx="2" ry="2.5"/><ellipse cx="59" cy="46" rx="2" ry="2.5"/></g><path className="mouth" d="M45 57q5 4 10 0" stroke="#764d3d" strokeWidth="2" strokeLinecap="round"/></svg></div>;
}

function App() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [speaking, setSpeaking] = useState(false);
  function ask(question: string) {
    const value = question.trim();
    if (!value) return;
    setMessages(current => [...current, { question: value, answer: answerQuestion(value, profile) }]);
    setInput('');
    setSpeaking(true);
    window.setTimeout(() => setSpeaking(false), 1200);
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); ask(input); }
  return <>
    <header className="topbar"><a className="brand" href="#top"><span className="brand-mark">✳</span> OpenCareer<span>Agent</span></a><nav aria-label="Main navigation"><a href="#work">Work</a><a href="#experience">Experience</a><a href="#about">About</a></nav><a className="top-contact" href={`mailto:${profile.candidate.contact}`}>Get in touch <span>↗</span></a></header>
    <main id="top">
      <section className="hero shell" id="about"><div className="hero-copy"><div className="eyebrow"><span className="status-dot"/> AN INTERACTIVE PORTFOLIO <span className="slash">/</span> OPEN TO CONVERSATION</div><h1>More than a résumé.<br/><em>Let’s talk.</em></h1><p>Get to know the work, the thinking, and the person behind it. Ask a question and explore the evidence for yourself.</p><div className="hero-meta"><span><span className="mini-dot"/> {profile.candidate.availability}</span><span>↳ &nbsp; No account needed</span></div></div><div className="hero-aside"><span className="aside-number">01 / 03</span><div className="asterisk">✳</div><p>GOOD WORK STARTS<br/>WITH A CONVERSATION.</p></div></section>
      <section className="workspace shell" aria-label="Career conversation">
        <aside className="profile-card"><div className="profile-top"><span className="tiny-label">THE PERSON BEHIND THE WORK</span><span className="spark">✳</span></div><div className="profile-avatar"><Avatar speaking={speaking}/><span className="online-dot"/></div><h2>{profile.candidate.name}</h2><p className="headline">{profile.candidate.headline}</p><div className="profile-location">⌖ &nbsp; {profile.candidate.location}</div><div className="profile-divider"/><p className="bio">{profile.candidate.summary}</p><div className="profile-divider"/><span className="tiny-label">A FEW THINGS I WORK WITH</span><div className="tags">{profile.skills.map(skill => <span key={skill.name}>{skill.name}</span>)}</div><a className="profile-link" href="#work">Explore my work <span>↗</span></a></aside>
        <div className="chat-card"><div className="chat-header"><div><div className="chat-title"><span className="chat-symbol">✳</span> The conversation <span className="live-label"><span/> READY TO CHAT</span></div><p>Ask about experience, projects, or how I work.</p></div><span className="chat-index">✦ &nbsp; YOUR QUESTIONS, ANSWERED</span></div><div className="chat-body" aria-live="polite"><div className="message agent-message"><Avatar/><div><div className="message-name">{profile.candidate.name}’s career agent <span>· &nbsp; just now</span></div><div className="bubble">Hi there! 👋 I’m here to help you get to know {profile.candidate.name}’s work. Ask me anything about the experience and projects in this portfolio.<br/><br/>What would you like to know?</div></div></div>{messages.map((message, index) => <div key={index} className="exchange"><div className="user-bubble">{message.question}</div><div className="message agent-message"><Avatar speaking={speaking && index === messages.length - 1}/><div><div className="message-name">Career agent <span>· &nbsp; based on the public profile</span></div><div className="bubble">{message.answer.text}{message.answer.followUp && <p className="follow-up">{message.answer.followUp}</p>}<EvidenceLinks evidence={message.answer.evidence}/></div></div></div></div>)}{messages.length === 0 && <div className="suggestions"><span>NOT SURE WHERE TO START?</span><div>{prompts.map(prompt => <button type="button" key={prompt} onClick={() => ask(prompt)}>{prompt} <span>↗</span></button>)}</div></div>}</div><form className="composer" onSubmit={submit}><label className="sr-only" htmlFor="question">Ask a question about the portfolio</label><input id="question" value={input} onChange={event => setInput(event.target.value)} placeholder="Ask me anything about my work..." autoComplete="off"/><button type="submit" aria-label="Send question">↑</button></form><div className="chat-foot"><span>✳ &nbsp; Answers use this public profile. Please verify the sources.</span><span>PRIVATE BY DEFAULT · NO CHAT SAVED</span></div></div>
      </section>
      <section className="work-section shell" id="work"><div className="section-heading"><div><div className="eyebrow">SELECTED WORK <span className="slash">/</span> THE PROOF IS IN THE PROJECTS</div><h2>Made with intention<span>.</span></h2></div><p>A closer look at the projects, decisions, and details behind the experience.</p></div><div className="project-grid">{profile.projects.map((project, index) => <article className="project-card" key={project.id}><div className="project-head"><span>0{index + 1} &nbsp; / &nbsp; PROJECT</span><span>↗</span></div><div className="project-art" aria-hidden="true"><span>{['◈','◎','▦'][index % 3]}</span></div><div className="project-content"><div className="project-role">{project.role}</div><h3>{project.name}</h3><p>{project.summary}</p><div className="tags">{project.stack.map(item => <span key={item}>{item}</span>)}</div><Sources ids={project.evidenceIds}/></div></article>)}</div></section>
      <section className="experience shell" id="experience"><div><div className="eyebrow">THE JOURNEY <span className="slash">/</span> EXPERIENCE</div><h2>Along the way<span>.</span></h2><p>Every chapter adds something to the work.</p></div><div className="timeline">{profile.timeline.map(item => <article key={`${item.period}-${item.title}`}><span>{item.period}</span><div><h3>{item.title}</h3><p>{item.organization} · {item.detail}</p><Sources ids={item.evidenceIds}/></div></article>)}</div></section>
      <footer className="footer shell"><div><span className="brand-mark">✳</span> OpenCareer<span>Agent</span></div><p>Built for better conversations. Powered by public evidence.</p><a href="#top">Back to top ↑</a></footer>
    </main>
  </>;
}

createRoot(document.getElementById('root')!).render(<App/>);
