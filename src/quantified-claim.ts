/**
 * Conservative guard for unsupported numeric premises in optional model FAQ
 * suggestions. A semantic match is not proof that a candidate achieved the
 * scale or percentage asserted by the recruiter's question.
 *
 * Only authored FAQ questions and answers may support the same quantity.
 * This is intentionally a narrow safety check, not numerical entailment.
 */
export interface QuantifiedFaq { questions: readonly string[]; answer: string }

const WORD_VALUES: Readonly<Record<string, number>> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90,
};
const SCALES: Readonly<Record<string, number>> = {
  hundred: 100, thousand: 1_000, million: 1_000_000,
  billion: 1_000_000_000, percent: 1,
};
const WORDS = Object.keys(WORD_VALUES).join('|');
const WORD_UNITS = 'one|two|three|four|five|six|seven|eight|nine';
const SCALE_WORDS = Object.keys(SCALES).join('|');
const SPELLED_QUANTITY = new RegExp(
  `\\b(?:${WORDS})(?:[\\s-]+(?:${WORD_UNITS}))?[\\s-]+(?:${SCALE_WORDS})\\b|\\bzero\\b`, 'gi',
);
const DIGIT_QUANTITY = /\b\d+(?:,\d{3})*(?:\.\d+)?(?:\s*(?:%|percent|hundred|thousand|million|billion))?(?![\p{L}\p{N}])/giu;

// Standalone small written numbers also assert headcount, team size or scale.
// Keep an isolated "one" unguarded: "show one example" is a common request,
// not evidence that the candidate led exactly one project.
const SMALL_SPELLED_QUANTITY = /\b(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[\s-]+(?:one|two|three|four|five|six|seven|eight|nine))?\b/gi;

function quantities(text: string): Set<number> {
  const found = new Set<number>();
  for (const match of text.matchAll(DIGIT_QUANTITY)) {
    const parts = match[0]!.toLowerCase().replace(/,/g, '').match(/^(\d+(?:\.\d+)?)(?:\s*(%|percent|hundred|thousand|million|billion))?$/);
    if (!parts) continue;
    const scale = parts[2] === '%' ? 1 : (SCALES[parts[2] ?? ''] ?? 1);
    const value = Number(parts[1]) * scale;
    if (Number.isFinite(value)) found.add(value);
  }
  const scaledSpans: Array<[number, number]> = [];
  for (const match of text.matchAll(SPELLED_QUANTITY)) {
    scaledSpans.push([match.index, match.index + match[0].length]);
    const tokens = match[0]!.toLowerCase().replace(/-/g, ' ').split(/\s+/);
    const suffix = tokens[tokens.length - 1]!;
    const scale = SCALES[suffix] ?? 1;
    const value = tokens.slice(0, scale === 1 && suffix !== 'percent' ? tokens.length : -1)
      .reduce((sum, token) => sum + (WORD_VALUES[token] ?? 0), 0) * scale;
    if (Number.isFinite(value)) found.add(value);
  }
  for (const match of text.matchAll(SMALL_SPELLED_QUANTITY)) {
    // "two million" must count as 2,000,000 only, never as both 2 and
    // 2,000,000; otherwise equivalent digit forms would be rejected.
    if (scaledSpans.some(([start, end]) => match.index < end && match.index + match[0].length > start)) continue;
    const value = match[0].toLowerCase().replace(/-/g, ' ').split(/\s+/)
      .reduce((sum, word) => sum + (WORD_VALUES[word] ?? 0), 0);
    if (value > 0) found.add(value);
  }
  return found;
}

/** True when a numeric premise is absent from the model-selected authored FAQ. */
export function hasUnsupportedQuantifiedPremise(question: string, faq: QuantifiedFaq): boolean {
  const asserted = quantities(question);
  if (asserted.size === 0) return false;
  const authored = quantities([...faq.questions, faq.answer].join(' '));
  return [...asserted].some(value => !authored.has(value));
}
