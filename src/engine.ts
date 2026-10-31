/** The profile is entirely public. Do not put private CV information here. */
export interface Evidence { id: string; label: string; url: string }
export interface Profile {
  candidate: { name: string; headline: string; location: string; summary: string; availability: string; contact: string };
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

function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object`);
  return value as Record<string, unknown>;
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

/** Parse and validate user-edited JSON before it reaches the UI or engine. */
export function validateProfile(value: unknown): Profile {
  const root = object(value, 'profile');
  const c = object(root.candidate, 'candidate');
  const candidate = {
    name: string(c.name, 'candidate.name'), headline: string(c.headline, 'candidate.headline'),
    location: string(c.location, 'candidate.location'), summary: string(c.summary, 'candidate.summary'),
    availability: string(c.availability, 'candidate.availability'), contact: string(c.contact, 'candidate.contact'),
  };
  const evidence = array(root.evidence, 'evidence', (item, path) => {
    const o = object(item, path);
    return { id: string(o.id, `${path}.id`), label: string(o.label, `${path}.label`), url: httpsUrl(o.url, `${path}.url`) };
  });
  const skills = array(root.skills, 'skills', (item, path) => {
    const o = object(item, path);
    return { name: string(o.name, `${path}.name`), category: string(o.category, `${path}.category`), evidenceIds: cited(o.evidenceIds, `${path}.evidenceIds`) };
  });
  const projects = array(root.projects, 'projects', (item, path) => {
    const o = object(item, path);
    return { id: string(o.id, `${path}.id`), name: string(o.name, `${path}.name`), role: string(o.role, `${path}.role`), summary: string(o.summary, `${path}.summary`), stack: strings(o.stack, `${path}.stack`), evidenceIds: cited(o.evidenceIds, `${path}.evidenceIds`) };
  });
  const timeline = array(root.timeline, 'timeline', (item, path) => {
    const o = object(item, path);
    return { period: string(o.period, `${path}.period`), title: string(o.title, `${path}.title`), organization: string(o.organization, `${path}.organization`), detail: string(o.detail, `${path}.detail`), evidenceIds: cited(o.evidenceIds, `${path}.evidenceIds`) };
  });
  const faq = array(root.faq, 'faq', (item, path) => {
    const o = object(item, path);
    const questions = strings(o.questions, `${path}.questions`);
    if (!questions.length) throw new Error(`${path}.questions must have at least one question`);
    return { id: string(o.id, `${path}.id`), questions, answer: string(o.answer, `${path}.answer`), evidenceIds: cited(o.evidenceIds, `${path}.evidenceIds`), followUp: string(o.followUp, `${path}.followUp`) };
  });
  const ids = new Set<string>();
  for (const source of evidence) {
    if (ids.has(source.id)) throw new Error(`Duplicate evidence id: ${source.id}`);
    ids.add(source.id);
  }
  for (const item of [...skills, ...projects, ...timeline, ...faq]) {
    for (const id of item.evidenceIds) if (!ids.has(id)) throw new Error(`Unknown evidence id: ${id}`);
  }
  const questionSet = new Set<string>();
  for (const item of faq) for (const question of item.questions) {
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
const PRIVATE_REQUEST = /\b(salary|compensation|pay|wage|home address|street address|phone number|passport|social security|ssn|date of birth|birth date|age|marital status|religion|medical|health|family|children|personal email)\b/i;
const FOLLOW_UP = 'What role, technology stack, and scale are you hiring for?';

/** No inference: authored exact answers first, then clearly labelled related project text. */
export function answerQuestion(question: string, profile: Profile): Answer {
  const query = normalize(question);
  if (!query) return { kind: 'unknown', text: 'Ask a question about the public profile or choose a suggested question.', evidence: [] };
  if (PRIVATE_REQUEST.test(query)) return { kind: 'private', text: 'I can only discuss information the candidate chose to publish. Please contact them directly about private details.', evidence: [] };
  const exact = profile.faq.find((entry) => entry.questions.some((item) => normalize(item) === query));
  if (exact) return { kind: 'answer', text: exact.answer, evidence: sources(exact.evidenceIds, profile), followUp: exact.followUp };
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
