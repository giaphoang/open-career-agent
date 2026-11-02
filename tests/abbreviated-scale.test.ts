import { describe, expect, it } from 'vitest';
import { hasUnsupportedQuantifiedPremise } from '../src/quantified-claim';

const leadership = {
  questions: ['Have you led a technical project?'],
  answer: 'Alex led the sample service architecture.',
};

describe('compact scale suffixes in recruiter claims', () => {
  it.each([
    'Did you manage 100k engineers?',
    'Did you support 100K engineers?',
    'Did you serve 1.5M users?',
    'Did you process 2B messages?',
  ])('withholds an unsupported abbreviated quantity: %s', question => {
    expect(hasUnsupportedQuantifiedPremise(question, leadership)).toBe(true);
  });

  it('matches equivalent public counts across compact, spelled, and comma-separated forms', () => {
    const documented = {
      questions: ['How much work did the example process?'],
      answer: 'It handled 100,000 events, 1,500,000 requests, and two billion messages.',
    };
    expect(hasUnsupportedQuantifiedPremise('Did it handle 100k events?', documented)).toBe(false);
    expect(hasUnsupportedQuantifiedPremise('Did it handle 1.5M requests?', documented)).toBe(false);
    expect(hasUnsupportedQuantifiedPremise('Did it handle 2B messages?', documented)).toBe(false);
    expect(hasUnsupportedQuantifiedPremise('Did it handle 200k events?', documented)).toBe(true);
  });

  it('keeps recognized units and comparison classes distinct', () => {
    const documented = {
      questions: ['How much did it process?'],
      answer: 'The service processed 100,000 events and 50,000 messages.',
    };
    expect(hasUnsupportedQuantifiedPremise('Did it handle 100k engineers?', documented)).toBe(true);
    expect(hasUnsupportedQuantifiedPremise('Did it handle 50K messages?', documented)).toBe(false);
    expect(hasUnsupportedQuantifiedPremise('Did it process over 100k events?', documented)).toBe(true);
    expect(hasUnsupportedQuantifiedPremise('Did it process about 50k messages?', documented)).toBe(true);
  });

  it('preserves version-number and percentage comparisons', () => {
    const documented = {
      questions: ['What technology was used?'],
      answer: 'Java 17, 90% test coverage, and a 100,000-event fixture.',
    };
    expect(hasUnsupportedQuantifiedPremise('Did you use Java 17?', documented)).toBe(false);
    expect(hasUnsupportedQuantifiedPremise('Was coverage 90%?', documented)).toBe(false);
    expect(hasUnsupportedQuantifiedPremise('Were there 90k events?', documented)).toBe(true);
  });
});
