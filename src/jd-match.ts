import type { Evidence, Profile } from './engine';

/** A keyword mention, not a statement that a candidate meets a requirement. */
export interface JobKeywordMatch {
  term: string;
  evidence: Evidence[];
  projects: string[];
}
export interface JobRequirement {
  text: string;
  status: 'keywords' | 'unrecognized' | 'context';
  matches: JobKeywordMatch[];
}
export type JobMatchResult =
  | { kind: 'ok'; requirements: JobRequirement[] }
  | { kind: 'invalid'; message: string };

interface Term {
  name: string;
  evidenceIds: Set<string>;
  projects: Set<string>;
}
const MAX_INPUT = 8_000;
const MAX_REQUIREMENTS = 100;
// These terms can change the meaning of a keyword mention. Suppress automatic
// matches for the entire line, including comma-separated items, and show it for
// manual review. This conservative English heuristic is not a JD parser.
const CONTEXT = /\b(?:no|not|never|without|exclude[ds]?|excluding|avoid|optional|optionally|prefer(?:red|able|ably|ence)?|bonus|nice[ -]to[ -]have|or|either|years?|yrs?|months?|mos?|senior|junior|staff|principal|lead|entry[ -]level|expert|advanced|proficient|fluent|beginner)\b|\b\d+(?:\.\d+)?\s*\+|(?<![\p{L}\p{N}_])(?:không|chẳng|tùy chọn|ưu tiên|năm|tháng|cao cấp|trưởng|chuyên gia)(?![\p{L}\p{N}_])/iu;
function normalized(text: string): string { return text.normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/gu, ' ').trim(); }
function literal(text: string): string { return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/**
 * Inspect a pasted JD locally. Keyword overlap is only a navigation aid: no
 * score, fit decision, missing-skill claim, proficiency or experience inference.
 */
export function matchJobDescription(input: string, profile: Profile): JobMatchResult {
  if (input.length > MAX_INPUT) return { kind: 'invalid', message: `Please use at most ${MAX_INPUT.toLocaleString('en-US')} characters.` };
  if (!input.trim()) return { kind: 'invalid', message: 'Paste a job description to inspect its keywords.' };
  const entries: { text: string; context: boolean }[] = [];
  for (const line of input.split(/\r?\n/u)) {
    const context = CONTEXT.test(line.normalize('NFKC'));
    for (const part of line.split(/[,;]+/u)) {
      const text = part.trim();
      if (text) entries.push({ text, context });
      if (entries.length > MAX_REQUIREMENTS) return { kind: 'invalid', message: `Please use at most ${MAX_REQUIREMENTS} items.` };
    }
  }
  if (!entries.length) return { kind: 'invalid', message: 'Paste a job description to inspect its keywords.' };
  const terms = new Map<string, Term>();
  function add(name: string, evidenceIds: readonly string[], project?: string) {
    const key = normalized(name);
    if (!key || key.length > 200) return;
    let entry = terms.get(key);
    if (!entry) { entry = { name, evidenceIds: new Set(), projects: new Set() }; terms.set(key, entry); }
    for (const id of evidenceIds) entry.evidenceIds.add(id);
    if (project) entry.projects.add(project);
  }
  for (const skill of profile.skills) add(skill.name, skill.evidenceIds);
  for (const project of profile.projects) for (const term of project.stack) add(term, project.evidenceIds, project.name);
  const candidates = [...terms.entries()].map(([key, value]) => ({
    key,
    value,
    pattern: new RegExp(`(^|[^\\p{L}\\p{N}_+#])${literal(key).replace(/ /g, '\\s+')}(?![\\p{L}\\p{N}_+#])`, 'iu'),
  }));
  const requirements: JobRequirement[] = entries.map(({ text, context }) => {
    if (context) return { text, status: 'context', matches: [] };
    const query = normalized(text);
    const matches = candidates.filter(({ key, pattern }) => (key.length > 1 || query === key) && pattern.test(query)).flatMap(({ value }) => {
      const evidence = profile.evidence.filter(source => value.evidenceIds.has(source.id));
      return evidence.length ? [{ term: value.name, evidence, projects: [...value.projects] }] : [];
    });
    return { text, status: matches.length ? 'keywords' : 'unrecognized', matches };
  });
  return { kind: 'ok', requirements };
}
