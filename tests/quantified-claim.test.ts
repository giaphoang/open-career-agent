import { describe, expect, it } from 'vitest';
import { hasUnsupportedQuantifiedPremise } from '../src/quantified-claim';

const leadership = {
  questions: ['Have you led a technical project?'],
  answer: 'Alex was technical lead for the sample Order Service.',
};

describe('numeric premises in optional model FAQ suggestions', () => {
  it.each([
    'Did you manage one thousand developers on this project?',
    'Did you manage 1,000 developers on this project?',
    'Did you manage 1000 developers on this project?',
    'Did you reduce AWS costs by ninety percent?',
    'Did the system serve thirty million users?',
    'Did it guarantee zero dropped messages globally?',
    'Did you work with every Fortune 500 company?',
  ])('suppresses an unverified magnitude: %s', question => {
    expect(hasUnsupportedQuantifiedPremise(question, leadership)).toBe(true);
  });

  it.each([
    'Did you manage two engineers?',
    'Did you mentor twelve direct reports?',
    'Did you lead twenty-four teams?',
    'Did you hire ninety people?',
  ])('suppresses a written small unsupported count: %s', question => {
    expect(hasUnsupportedQuantifiedPremise(question, leadership)).toBe(true);
  });

  it('compares written small counts with authored digits and vice versa', () => {
    const documented = { questions: ['How big was your team?'], answer: 'Alex mentored 24 engineers across 2 teams.' };
    expect(hasUnsupportedQuantifiedPremise('Did you mentor twenty-four engineers?', documented)).toBe(false);
    expect(hasUnsupportedQuantifiedPremise('Did you mentor twenty four engineers?', documented)).toBe(false);
    expect(hasUnsupportedQuantifiedPremise('Did you lead two teams?', documented)).toBe(false);
    expect(hasUnsupportedQuantifiedPremise('Did you lead three teams?', documented)).toBe(true);
    expect(hasUnsupportedQuantifiedPremise('Did you mentor twenty-five engineers?', documented)).toBe(true);
  });

  it('does not interpret part of a written scale as a separate small count', () => {
    const documented = { questions: ['How many events?'], answer: 'The project processed 2,000,000 events and 24,000 requests.' };
    expect(hasUnsupportedQuantifiedPremise('Did you process two million events?', documented)).toBe(false);
    expect(hasUnsupportedQuantifiedPremise('Did you process twenty-four thousand requests?', documented)).toBe(false);
    expect(hasUnsupportedQuantifiedPremise('Did you process two thousand requests?', documented)).toBe(true);
  });

  it('does not block ordinary paraphrases or an incidental use of one', () => {
    expect(hasUnsupportedQuantifiedPremise('Which projects did you lead?', leadership)).toBe(false);
    expect(hasUnsupportedQuantifiedPremise('Show one example of a technical project.', leadership)).toBe(false);
  });

  it('accepts equivalent authored digits and spelled quantities without claiming verification', () => {
    const documented = {
      questions: ['Did the sample process 1,000 events?'],
      answer: 'The sample processed 90% of a test batch containing 30,000,000 events.',
    };
    expect(hasUnsupportedQuantifiedPremise('Did it process one thousand events?', documented)).toBe(false);
    expect(hasUnsupportedQuantifiedPremise('Did you process thirty million events?', documented)).toBe(false);
    expect(hasUnsupportedQuantifiedPremise('Was ninety percent of the batch processed?', documented)).toBe(false);
    expect(hasUnsupportedQuantifiedPremise('Did you process two billion events?', documented)).toBe(true);
  });

  it('does not confuse Java version numbers with an unrelated quantity', () => {
    expect(hasUnsupportedQuantifiedPremise('Have you used Java 17?', {
      questions: ['Which Java versions have you used?'],
      answer: 'The public example uses Java 17.',
    })).toBe(false);
    expect(hasUnsupportedQuantifiedPremise('Have you used Java 21?', {
      questions: ['Which Java versions have you used?'],
      answer: 'The public example uses Java 17.',
    })).toBe(true);
  });

  it('does not mistake a percentage for an equally numbered headcount', () => {
    const percentOnly = { questions: ['What was the improvement?'], answer: 'The sample improved throughput by 90%.' };
    const countOnly = { questions: ['How large was the team?'], answer: 'The sample included 90 engineers.' };
    expect(hasUnsupportedQuantifiedPremise('Did you lead ninety engineers?', percentOnly)).toBe(true);
    expect(hasUnsupportedQuantifiedPremise('Did you manage 90 engineers?', percentOnly)).toBe(true);
    expect(hasUnsupportedQuantifiedPremise('Did you achieve ninety percent improvement?', countOnly)).toBe(true);
    expect(hasUnsupportedQuantifiedPremise('Did you achieve 90% improvement?', countOnly)).toBe(true);
    // Matching values within a dimension remain eligible for the authored FAQ.
    expect(hasUnsupportedQuantifiedPremise('Was the improvement ninety percent?', percentOnly)).toBe(false);
    expect(hasUnsupportedQuantifiedPremise('Did you manage ninety engineers?', countOnly)).toBe(false);
  });

  it('keeps percentages separate even when the FAQ contains other counts', () => {
    const mixed = { questions: ['What was the result?'], answer: 'The sample involved 24 engineers and achieved 90% availability.' };
    expect(hasUnsupportedQuantifiedPremise('Did you reach 24% availability?', mixed)).toBe(true);
    expect(hasUnsupportedQuantifiedPremise('Did you work with 90 engineers?', mixed)).toBe(true);
    expect(hasUnsupportedQuantifiedPremise('Did you reach ninety percent availability?', mixed)).toBe(false);
    expect(hasUnsupportedQuantifiedPremise('Did you work with twenty-four engineers?', mixed)).toBe(false);
  });

  it('rejects a reused number when it counts a different entity', () => {
    const documented = {
      questions: ['How large was the example project?'],
      answer: 'The sample processed 24,000 events with 90 engineers across 2 teams.',
    };
    expect(hasUnsupportedQuantifiedPremise('Did you lead 90 teams?', documented)).toBe(true);
    expect(hasUnsupportedQuantifiedPremise('Did you mentor ninety engineers?', documented)).toBe(false);
    expect(hasUnsupportedQuantifiedPremise('Did you lead two teams?', documented)).toBe(false);
    expect(hasUnsupportedQuantifiedPremise('Did the sample process 24,000 requests?', documented)).toBe(true);
    expect(hasUnsupportedQuantifiedPremise('Did it process twenty-four thousand events?', documented)).toBe(false);
    // Matching a count noun only allows an authored FAQ to be shown as related;
    // it never verifies the action asserted in the recruiter's question.
  });

  it('checks every recognized count unit independently, including plural aliases', () => {
    const documented = {
      questions: ['How many people worked there?'],
      answer: 'The example had 24 people and handled 24 events.',
    };
    expect(hasUnsupportedQuantifiedPremise('Were there twenty-four persons?', documented)).toBe(false);
    expect(hasUnsupportedQuantifiedPremise('Were there 24 events and 24 persons?', documented)).toBe(false);
    expect(hasUnsupportedQuantifiedPremise('Were there 24 events and 24 teams?', documented)).toBe(true);
    expect(hasUnsupportedQuantifiedPremise('Did you serve 24 users?', documented)).toBe(true);
    expect(hasUnsupportedQuantifiedPremise('Did you use Java 17?', {
      questions: ['What Java versions?'], answer: 'Java 17 was used.',
    })).toBe(false);
  });

  it('does not equate different percentages or large numeric claims', () => {
    expect(hasUnsupportedQuantifiedPremise('Was 99% availability achieved?', {
      questions: ['What is the system availability?'],
      answer: 'The sample observed 90% availability.',
    })).toBe(true);
  });
});
