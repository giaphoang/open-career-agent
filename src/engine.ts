/** The profile is entirely public. Do not put private CV information here. */
export interface Evidence { id: string; label: string; url: string }
export interface Profile {
  candidate: { name: string; headline: string; headlineEvidenceIds: string[]; location: string; summary: string; summaryEvidenceIds: string[]; availability: string; contact: string };
  skills: { name: string; category: string; evidenceIds: string[] }[];
  projects: { id: string; name: string; role: string; summary: string; stack: string[]; evidenceIds: string[] }[];
  timeline: { period: string; title: string; organization: string; detail: string; evidenceIds: string[] }[];
  evidence: Evidence[];
  faq: { id: string; questions: string[]; answer: string; evidenceIds: string[]; followUp: string }[];
}
export interface Answer {
  kind: 'answer' | 'related' | 'unknown' | 'private';
  text: string;
  evidence: Evidence[];
  followUp?: string;
}

function object(value: unknown, path: string, allowed: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object`);
  const result = value as Record<string, unknown>;
  for (const key of Object.keys(result)) if (!allowed.includes(key)) throw new Error(`Unknown field: ${path}.${key}`);
  return result;
}
function string(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${path} must be a non-empty string`);
  return value.trim();
}
function array<T>(value: unknown, path: string, parse: (item: unknown, path: string) => T): T[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value.map((item: unknown, index: number) => parse(item, `${path}[${index}]`));
}
function strings(value: unknown, path: string): string[] { return array(value, path, string); }
function cited(value: unknown, path: string): string[] {
  const ids = strings(value, path);
  if (!ids.length) throw new Error(`${path} must have at least one evidence reference`);
  return ids;
}
function httpsUrl(value: unknown, path: string): string {
  const url = string(value, path);
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error(`${path} must be a valid HTTPS URL`); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error(`${path} must be an HTTPS URL without credentials`);
  return url;
}

/** Reserved DNS names and direct IP hosts cannot substantiate public career claims. */
export function isPlaceholderEvidenceUrl(url: string): boolean {
  try {
    // DNS hostnames can end in a root dot; this must not bypass the guard.
    const host = new URL(url).hostname.toLowerCase().replace(/\.+$/, '');
    // IP-literal URLs (including IPv4 forms normalized by URL, and bracketed
    // IPv6) often point to local/private hosts and lack a stable public identity.
    // Require a public HTTPS hostname for evidence rather than guessing which
    // direct IPs are safe or independently verifiable.
    const ipLiteral = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host) || (host.startsWith('[') && host.endsWith(']'));
    // A valid HTTPS URL can still point to a name that works only on a local
    // network or in an alternative naming system. Neither is public evidence.
    const nonPublicName = !host.includes('.') ||
      /(^|\.)(?:local|internal|alt|onion)$/.test(host) ||
      /(^|\.)home\.arpa$/.test(host);
    return ipLiteral || nonPublicName || /(^|\.)example\.(?:com|org|net)$/.test(host) ||
      /(^|\.)(?:example|test|invalid|localhost)$/.test(host);
  } catch { return false; }
}

/** Keep the one intentionally fictional bundled sample usable as a demo. */
export function isFictionalSampleProfile(candidate: Profile['candidate']): boolean {
  return candidate.name === 'Alex Morgan' && candidate.location === 'Remote · Example profile' &&
    candidate.summary.includes('This is fictional sample content');
}

/** Parse and validate user-edited JSON before it reaches the UI or engine. */
export function validateProfile(value: unknown): Profile {
  const root = object(value, 'profile', ['candidate', 'skills', 'projects', 'timeline', 'evidence', 'faq']);
  const c = object(root.candidate, 'candidate', ['name', 'headline', 'headlineEvidenceIds', 'location', 'summary', 'summaryEvidenceIds', 'availability', 'contact']);
  const candidate = {
    name: string(c.name, 'candidate.name'), headline: string(c.headline, 'candidate.headline'), headlineEvidenceIds: cited(c.headlineEvidenceIds, 'candidate.headlineEvidenceIds'),
    location: string(c.location, 'candidate.location'), summary: string(c.summary, 'candidate.summary'), summaryEvidenceIds: cited(c.summaryEvidenceIds, 'candidate.summaryEvidenceIds'),
    availability: string(c.availability, 'candidate.availability'), contact: string(c.contact, 'candidate.contact'),
  };
  const evidence = array(root.evidence, 'evidence', (item, path) => {
    const o = object(item, path, ['id', 'label', 'url']);
    return { id: string(o.id, `${path}.id`), label: string(o.label, `${path}.label`), url: httpsUrl(o.url, `${path}.url`) };
  });
  if (evidence.some(source => isPlaceholderEvidenceUrl(source.url)) && !isFictionalSampleProfile(candidate)) {
    throw new Error('Placeholder or IP-address evidence URLs (including private-network names) are allowed only in the fictional sample profile; supply real public HTTPS domain sources');
  }
  const skills = array(root.skills, 'skills', (item, path) => {
    const o = object(item, path, ['name', 'category', 'evidenceIds']);
    return { name: string(o.name, `${path}.name`), category: string(o.category, `${path}.category`), evidenceIds: cited(o.evidenceIds, `${path}.evidenceIds`) };
  });
  const projects = array(root.projects, 'projects', (item, path) => {
    const o = object(item, path, ['id', 'name', 'role', 'summary', 'stack', 'evidenceIds']);
    return { id: string(o.id, `${path}.id`), name: string(o.name, `${path}.name`), role: string(o.role, `${path}.role`), summary: string(o.summary, `${path}.summary`), stack: strings(o.stack, `${path}.stack`), evidenceIds: cited(o.evidenceIds, `${path}.evidenceIds`) };
  });
  const timeline = array(root.timeline, 'timeline', (item, path) => {
    const o = object(item, path, ['period', 'title', 'organization', 'detail', 'evidenceIds']);
    return { period: string(o.period, `${path}.period`), title: string(o.title, `${path}.title`), organization: string(o.organization, `${path}.organization`), detail: string(o.detail, `${path}.detail`), evidenceIds: cited(o.evidenceIds, `${path}.evidenceIds`) };
  });
  const faq = array(root.faq, 'faq', (item, path) => {
    const o = object(item, path, ['id', 'questions', 'answer', 'evidenceIds', 'followUp']);
    const questions = strings(o.questions, `${path}.questions`);
    if (!questions.length) throw new Error(`${path}.questions must have at least one question`);
    return { id: string(o.id, `${path}.id`), questions, answer: string(o.answer, `${path}.answer`), evidenceIds: cited(o.evidenceIds, `${path}.evidenceIds`), followUp: string(o.followUp, `${path}.followUp`) };
  });
  const ids = new Set<string>();
  for (const source of evidence) {
    if (ids.has(source.id)) throw new Error(`Duplicate evidence id: ${source.id}`);
    ids.add(source.id);
  }
  for (const id of [...candidate.headlineEvidenceIds, ...candidate.summaryEvidenceIds]) if (!ids.has(id)) throw new Error(`Unknown evidence id: ${id}`);
  for (const item of [...skills, ...projects, ...timeline, ...faq]) {
    for (const id of item.evidenceIds) if (!ids.has(id)) throw new Error(`Unknown evidence id: ${id}`);
  }
  const questionSet = new Set<string>();
  for (const item of faq) for (const question of item.questions) {
    if (isPrivateQuestion(question)) throw new Error('FAQ questions cannot ask for private information');
    const normalized = normalize(question);
    if (!normalized || questionSet.has(normalized)) throw new Error(`Duplicate or empty FAQ question: ${question}`);
    questionSet.add(normalized);
  }
  return { candidate, skills, projects, timeline, evidence, faq };
}

function normalize(value: string): string {
  return value.toLocaleLowerCase('en-US').normalize('NFKC').replace(/[^\p{L}\p{N}+#]+/gu, ' ').trim().replace(/\s+/g, ' ');
}
function sources(ids: string[], profile: Profile): Evidence[] {
  const wanted = new Set(ids);
  return profile.evidence.filter((source) => wanted.has(source.id));
}
const PRIVATE_REQUEST = /\b(salary|compensation|pay|wage|home address|street address|residential address|mailing address|phone number|mobile (?:phone|number)|cell(?:ular)? (?:phone|number)|cellphone|personal phone|email address|private email|passport|social security|ssn|date of birth|birth date|birthdate|birth year|year of birth|birthday|dob|when were you born|how old|age|marital status|religion|medical|health|family|children|personal email)\b/i;
const FOLLOW_UP = 'What role, technology stack, and scale are you hiring for?';
export function isPrivateQuestion(question: string): boolean { return PRIVATE_REQUEST.test(normalize(question)); }

/** An exact salutation needs no profile facts, retrieval or probabilistic model. */
const GREETING_ONLY = /^(?:hi|hello|hey|good (?:morning|afternoon|evening)|xin chào|chào)(?:\s+there)?[!?.\s,]*$/i;
export function deterministicGreeting(question: string): Answer | null {
  if (!GREETING_ONLY.test(question.trim())) return null;
  return { kind: 'answer',
    text: 'Hello! Ask about the candidate’s projects, skills, or experience. Please check the public sources.',
    evidence: [] };
}

export interface CareerSearchResult {
  skills: Profile['skills'];
  projects: Profile['projects'];
  evidence: Evidence[];
}

/** Look up only complete published skill, project, and stack terms. */
export function searchCareer(query: string, profile: Profile): CareerSearchResult {
  const normalizedQuery = normalize(query);
  const padded = ` ${normalizedQuery} `;
  const matches = (term: string): boolean => {
    const normalized = normalize(term);
    return normalized.length > 0 && (normalized.length >= 2 || normalizedQuery === normalized) && padded.includes(` ${normalized} `);
  };
  const skills = profile.skills.filter((skill) => matches(skill.name));
  const projects = profile.projects.filter((project) => [project.name, ...project.stack].some(matches));
  return { skills, projects, evidence: sources([...skills, ...projects].flatMap((item) => item.evidenceIds), profile) };
}

export type InterviewStep = 'role' | 'stack' | 'scale' | 'priorities' | 'complete';
type InterviewAnswerStep = Exclude<InterviewStep, 'complete'>;
export interface InterviewState {
  step: InterviewStep;
  answers: Partial<Record<InterviewAnswerStep, string>>;
}
export interface InterviewTurn { state: InterviewState; text: string; followUp?: string }

const INTERVIEW_QUESTIONS: Record<InterviewAnswerStep, string> = {
  role: 'What role are you hiring for?',
  stack: 'Which technologies or stack matter for this role?',
  scale: 'What scale or workload should the candidate expect?',
  priorities: 'Which outcomes or priorities matter most?',
};
const NEXT_INTERVIEW_STEP: Record<InterviewAnswerStep, InterviewStep> = {
  role: 'stack', stack: 'scale', scale: 'priorities', priorities: 'complete',
};

/** Interview answers stay in the state owned by the caller; nothing is persisted. */
export function startInterview(): InterviewTurn {
  return { state: { step: 'role', answers: {} }, text: 'Let’s learn a little about the role. You can reply “skip” to any question.', followUp: INTERVIEW_QUESTIONS.role };
}
export function advanceInterview(state: InterviewState, input: string): InterviewTurn {
  if (state.step === 'complete') return { state, text: 'The role questions are complete. You can ask about the public evidence.' };
  const reply = input.trim();
  if (!reply || reply.length > 500) return { state, text: 'Please enter a reply of 1–500 characters, or type “skip”.', followUp: INTERVIEW_QUESTIONS[state.step] };
  const answers = { ...state.answers, [state.step]: normalize(reply) === 'skip' ? '' : reply };
  const step = NEXT_INTERVIEW_STEP[state.step];
  const next: InterviewState = { step, answers };
  if (step === 'complete') return { state: next, text: 'Thanks for sharing the role context. You can now explore the public evidence.' };
  return { state: next, text: 'Thanks. You can also reply “skip”.', followUp: INTERVIEW_QUESTIONS[step] };
}

/** No inference: authored exact answers first, then clearly labelled related project text. */
export function answerQuestion(question: string, profile: Profile): Answer {
  const query = normalize(question);
  if (!query) return { kind: 'unknown', text: 'Ask a question about the public profile or choose a suggested question.', evidence: [] };
  if (isPrivateQuestion(question)) return { kind: 'private', text: 'I can only discuss information the candidate chose to publish. Please contact them directly about private details.', evidence: [] };
  const greeting = deterministicGreeting(question);
  if (greeting) return greeting;
  const exact = profile.faq.find((entry) => entry.questions.some((item) => normalize(item) === query));
  if (exact) return { kind: 'answer', text: exact.answer, evidence: sources(exact.evidenceIds, profile), followUp: exact.followUp };
  const skillQuestions = ['what skills do you have', 'which skills do you have', 'what tools have you used', 'what is your technology stack'];
  if (skillQuestions.includes(query) && profile.skills.length) return {
    kind: 'answer',
    text: `The public profile lists these skills: ${profile.skills.map((skill) => skill.name).join(', ')}.`,
    evidence: sources(profile.skills.flatMap((skill) => skill.evidenceIds), profile),
    followUp: 'Which skills are most important for the role?',
  };
  // Only match a complete project name or stack item. Do not infer a yes/no answer
  // or silently present loosely related text as proof of the question's premise.
  const padded = ` ${query} `;
  const related = profile.projects.find((project) => [project.name, ...project.stack].some((term) => {
    const normalized = normalize(term);
    return normalized.length >= 3 && padded.includes(` ${normalized} `);
  }));
  if (related) return {
    kind: 'related',
    text: `I can't verify the specific claim in your question. Related public project: ${related.name} — ${related.summary}`,
    evidence: sources(related.evidenceIds, profile), followUp: FOLLOW_UP,
  };
  return { kind: 'unknown', text: "I don't have enough public evidence to answer that. Please ask the candidate directly.", evidence: [], followUp: FOLLOW_UP };
}
