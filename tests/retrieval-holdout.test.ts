import { describe, expect, it } from 'vitest';
import { answerQuestion, validateProfile } from '../src/engine';
import sampleProfile from './fixtures/sample-profile.json';
import calibration from './fixtures/retrieval-corpus.json';
import holdout from './fixtures/retrieval-holdout.json';

type Case = { question: string; faqId?: string };
const categories = ['paraphrases', 'unrelated', 'sensitive', 'ambiguous'] as const;
const normalize = (value: string) => value.toLocaleLowerCase('en-US').normalize('NFKC')
  .replace(/[^\p{L}\p{N}+#]+/gu, ' ').trim().replace(/\s+/g, ' ');

describe('independent synthetic WASM relevance holdout', () => {
  const profile = validateProfile(sampleProfile);
  it('is non-overlapping, correctly labeled and separate from authored FAQs', () => {
    expect(holdout.version).toBe(1);
    const seen = new Set<string>(categories.flatMap(category =>
      (calibration[category] as readonly Case[]).map(row => normalize(row.question))));
    const authored = new Set(profile.faq.flatMap(faq => faq.questions.map(normalize)));
    const faqIds = new Set(profile.faq.map(faq => faq.id));
    let count = 0;
    for (const category of categories) {
      const rows = holdout[category] as readonly Case[];
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        const key = normalize(row.question);
        expect(key).not.toBe('');
        expect(seen.has(key)).toBe(false);
        expect(authored.has(key)).toBe(false);
        if (category === 'paraphrases') expect(faqIds.has(row.faqId ?? '')).toBe(true);
        else expect(row.faqId).toBeUndefined();
        seen.add(key);
        count++;
      }
    }
    expect(count).toBe(48);
  });

  it('preserves deterministic privacy and evidence-backed abstention', () => {
    for (const category of categories) {
      for (const row of holdout[category]) {
        const answer = answerQuestion(row.question, profile);
        if (category === 'sensitive') {
          expect(answer.kind, row.question).toBe('private');
          expect(answer.evidence).toHaveLength(0);
        } else if (category === 'unrelated') {
          expect(answer.kind, row.question).toBe('unknown');
          expect(answer.evidence).toHaveLength(0);
        } else {
          expect(['answer', 'related', 'unknown']).toContain(answer.kind);
          if (answer.kind === 'related') {
            expect(answer.evidence.length, row.question).toBeGreaterThan(0);
            expect(answer.text, row.question).toMatch(/can't verify|can’t verify/);
          }
          if (answer.kind === 'unknown') expect(answer.evidence).toHaveLength(0);
        }
      }
    }
  });
});
