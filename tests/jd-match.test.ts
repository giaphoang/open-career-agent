import { describe, expect, it } from 'vitest';
import sample from './fixtures/sample-profile.json';
import { validateProfile } from '../src/engine';
import { matchJobDescription } from '../src/jd-match';

const profile = validateProfile(sample);

describe('job description keyword explorer', () => {
  it('shows exact public skills and project stack terms with relevant citations', () => {
    const result = matchJobDescription('Java\nReact\nKubernetes', profile);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.requirements.map(item => item.status)).toEqual(['keywords', 'keywords', 'unrecognized']);
    expect(result.requirements[0]?.matches[0]).toMatchObject({ term: 'Java', projects: ['Order Service', 'Event Pipeline'] });
    expect(result.requirements[0]?.matches[0]?.evidence.map(source => source.id)).toEqual(['orders', 'events']);
    expect(result.requirements[1]?.matches[0]).toMatchObject({ term: 'React', projects: ['Operations Dashboard'] });
    expect(result.requirements[2]?.matches).toEqual([]);
  });

  it('does not mistake JavaScript for Java or language names that share prefixes', () => {
    const result = matchJobDescription('JavaScript\nTypeScript\nJava', profile);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.requirements.map(item => item.matches.map(match => match.term))).toEqual([[], ['TypeScript'], ['Java']]);
  });

  it('holds negated, optional, seniority, and duration context for human review', () => {
    const result = matchJobDescription('No Java required, AWS\n10 years Java\nReact is optional\nSenior Java engineer\nJava or React\nKhông yêu cầu Java\nReact', profile);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.requirements.map(item => item.status)).toEqual(['context', 'context', 'context', 'context', 'context', 'context', 'context', 'keywords']);
    expect(result.requirements.slice(0, 7).every(item => item.matches.length === 0)).toBe(true);
  });

  it('matches symbols literally and prevents fabricated source references', () => {
    const custom = structuredClone(profile);
    custom.skills = [{ name: 'C++', category: 'Languages', evidenceIds: ['orders'] }, { name: 'C#', category: 'Languages', evidenceIds: ['missing'] }];
    custom.projects = [];
    const result = matchJobDescription('C++, C#, C', custom);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.requirements.map(item => item.matches.map(match => match.term))).toEqual([['C++'], [], []]);
  });

  it('rejects empty, oversized and excessive-item inputs without processing', () => {
    expect(matchJobDescription('  ', profile).kind).toBe('invalid');
    expect(matchJobDescription('x'.repeat(8001), profile).kind).toBe('invalid');
    expect(matchJobDescription(Array(101).fill('Java').join('\n'), profile).kind).toBe('invalid');
  });
});
