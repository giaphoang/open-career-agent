import { describe, expect, it } from 'vitest';
import profileData from './fixtures/sample-profile.json';
import configuredProfile from '../src/data/profile.json';
import { answerQuestion, validateProfile } from '../src/engine';

const profile = validateProfile(profileData);

describe('career answers', () => {
  it('answers at least 20 standard questions with authored, cited content', () => {
    expect(profile.faq.length).toBeGreaterThanOrEqual(20);
    for (const entry of profile.faq) {
      for (const question of entry.questions) {
        const answer = answerQuestion(question.toUpperCase(), profile);
        expect(answer.kind, question).toBe('answer');
        expect(answer.text, question).toBe(entry.answer);
        expect(answer.evidence.map((source) => source.id), question).toEqual(
          profile.evidence.filter((source) => entry.evidenceIds.includes(source.id)).map((source) => source.id),
        );
        expect(answer.evidence.length, question).toBeGreaterThan(0);
        expect(answer.followUp, question).toBeTruthy();
      }
    }
  });

  it('provides only related evidence rather than affirming an unsupported claim', () => {
    const result = answerQuestion('Did you scale Java to a billion users?', profile);
    expect(result.kind).toBe('related');
    expect(result.text).toContain("can't verify");
    expect(result.text).not.toContain('billion');
    expect(result.evidence.map((source) => source.id)).toEqual(['orders']);
  });

  it('declines unknown and sensitive questions, even when they name a project', () => {
    expect(answerQuestion('Are you a Nobel Prize winner?', profile)).toMatchObject({ kind: 'unknown', evidence: [] });
    expect(answerQuestion('What is your salary on the Java project?', profile)).toMatchObject({ kind: 'private', evidence: [] });
    expect(answerQuestion('   ', profile)).toMatchObject({ kind: 'unknown', evidence: [] });
  });
});

describe('public profile validation', () => {
  it('accepts the configured public profile', () => {
    expect(() => validateProfile(configuredProfile)).not.toThrow();
  });
  it('accepts a clean public profile', () => {
    expect(profile.candidate.name).toBe('Alex Morgan');
    expect(profile.evidence.length).toBeGreaterThan(0);
  });

  it('rejects a missing citation and invalid source links', () => {
    const missing = structuredClone(profileData);
    missing.faq[0]!.evidenceIds = ['does-not-exist'];
    expect(() => validateProfile(missing)).toThrow('Unknown evidence id');
    const empty = structuredClone(profileData);
    empty.faq[0]!.evidenceIds = [];
    expect(() => validateProfile(empty)).toThrow('at least one evidence');
    const unsafe = structuredClone(profileData);
    unsafe.evidence[0]!.url = 'javascript:alert(1)';
    expect(() => validateProfile(unsafe)).toThrow('HTTPS URL');
    const credentials = structuredClone(profileData);
    credentials.evidence[0]!.url = 'https://user:password@example.com/';
    expect(() => validateProfile(credentials)).toThrow('without credentials');
  });

  it('rejects ambiguous duplicate questions and duplicate evidence ids', () => {
    const duplicate = structuredClone(profileData);
    duplicate.faq[1]!.questions = [duplicate.faq[0]!.questions[0]!.toUpperCase()];
    expect(() => validateProfile(duplicate)).toThrow('Duplicate or empty FAQ question');
    const sources = structuredClone(profileData);
    sources.evidence[1]!.id = sources.evidence[0]!.id;
    expect(() => validateProfile(sources)).toThrow('Duplicate evidence id');
  });
});
