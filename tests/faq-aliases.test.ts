import { describe, expect, it } from 'vitest';
import { answerQuestion, validateProfile } from '../src/engine';
import sampleProfile from './fixtures/sample-profile.json';

// These are topic-level alternatives, not synthetic metrics or new career claims.
// They must resolve to the same authored answer and citations as the parent FAQ.
const aliases = [
  ['database', 'Which persistence and data-storage technologies have your projects used?'],
  ['runbook', 'Where are service troubleshooting steps and runbooks documented?'],
] as const;

describe('evidence-scoped FAQ alias coverage', () => {
  const profile = validateProfile(sampleProfile);

  it.each(aliases)('resolves %s through an authored question and its evidence', (id, question) => {
    const faq = profile.faq.find(item => item.id === id);
    expect(faq?.questions).toContain(question);
    const result = answerQuestion(question, profile);
    expect(result.kind).toBe('answer');
    expect(result.text).toBe(faq?.answer);
    expect(result.evidence.map(source => source.id).sort()).toEqual([...faq!.evidenceIds].sort());
    expect(result.evidence.every(source => source.url.startsWith('https://'))).toBe(true);
  });

  it('keeps unsupported free-form career assertions outside deterministic exact answers', () => {
    const result = answerQuestion('Did you personally guarantee zero failures for every database?', profile);
    expect(result.kind).not.toBe('answer');
  });
});
