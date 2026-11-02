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

  it('does not equate different percentages or large numeric claims', () => {
    expect(hasUnsupportedQuantifiedPremise('Was 99% availability achieved?', {
      questions: ['What is the system availability?'],
      answer: 'The sample observed 90% availability.',
    })).toBe(true);
  });
});
