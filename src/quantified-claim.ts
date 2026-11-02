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
// Compact recruiter scale notation (100k users, 1.5M events, 2B requests).
// Keep abbreviations out of SPELLED_QUANTITY: these are digit suffixes.
const ABBREVIATED_SCALES: Readonly<Record<string, number>> = { k: 1_000, m: 1_000_000, b: 1_000_000_000 };
const WORDS = Object.keys(WORD_VALUES).join('|');
const WORD_UNITS = 'one|two|three|four|five|six|seven|eight|nine';
const SCALE_WORDS = Object.keys(SCALES).join('|');
const SPELLED_QUANTITY = new RegExp(
  `\\b(?:${WORDS})(?:[\\s-]+(?:${WORD_UNITS}))?[\\s-]+(?:${SCALE_WORDS})\\b|\\bzero\\b`, 'gi',
);
const DIGIT_QUANTITY = /\b\d+(?:,\d{3})*(?:\.\d+)?(?:[kmb]|\s*(?:%|percent|hundred|thousand|million|billion))?(?![\p{L}\p{N}])/giu;

// Standalone small written numbers also assert headcount, team size or scale.
// Keep an isolated "one" unguarded: "show one example" is a common request,
// not evidence that the candidate led exactly one project.
const SMALL_SPELLED_QUANTITY = /\b(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[\s-]+(?:one|two|three|four|five|six|seven|eight|nine))?\b/gi;

// When a number describes a recognized entity, the FAQ must support that
// entity, not merely contain the same number for a different kind of count.
// Intentionally narrow: this does not attempt to infer employment relationships.
const COUNTED_UNIT = 'engineers?|developers?|teams?|projects?|users?|customers?|subscribers?|employees?|members?|people|persons?|events?|messages?|requests?|transactions?|systems?|services?|devices?|machines?|applications?|products?|years?|months?|dollars?';
// Include magnitude suffixes for digit forms too (e.g., 90 thousand engineers):
// otherwise a matching 90,000 count can bypass the count-noun safety check.
const COUNTED_NUMBER = `(?:\\d+(?:,\\d{3})*(?:\\.\\d+)?(?:[kmb]|[\\s-]+(?:hundred|thousand|million|billion))?|(?:${WORDS})(?:[\\s-]+(?:${WORD_UNITS}))?(?:[\\s-]+(?:hundred|thousand|million|billion))?)`;
const COUNTED_PHRASE = new RegExp(`\\b(${COUNTED_NUMBER})(?:\\s*\\+)?[\\s-]+(${COUNTED_UNIT})\\b`, 'gi');
// Percentages and headcounts sharing a number are different assertions.
// These coarse dimensions are a safety check, not factual entailment.
type QuantityKind = 'percent' | 'count';
const quantityKey = (value: number, kind: QuantityKind): string => `${kind}:${value}`;

function quantities(text: string): Set<string> {
  const found = new Set<string>();
  for (const match of text.matchAll(DIGIT_QUANTITY)) {
    const parts = match[0]!.toLowerCase().replace(/,/g, '').match(/^(\d+(?:\.\d+)?)(?:\s*(%|percent|hundred|thousand|million|billion|k|m|b))?$/);
    if (!parts) continue;
    const scale = parts[2] === '%' ? 1 : (SCALES[parts[2] ?? ''] ?? ABBREVIATED_SCALES[parts[2] ?? ''] ?? 1);
    const value = Number(parts[1]) * scale;
    if (Number.isFinite(value)) found.add(quantityKey(value, parts[2] === '%' || parts[2] === 'percent' ? 'percent' : 'count'));
  }
  const scaledSpans: Array<[number, number]> = [];
  for (const match of text.matchAll(SPELLED_QUANTITY)) {
    scaledSpans.push([match.index, match.index + match[0].length]);
    const tokens = match[0]!.toLowerCase().replace(/-/g, ' ').split(/\s+/);
    const suffix = tokens[tokens.length - 1]!;
    const scale = SCALES[suffix] ?? 1;
    const value = tokens.slice(0, scale === 1 && suffix !== 'percent' ? tokens.length : -1)
      .reduce((sum, token) => sum + (WORD_VALUES[token] ?? 0), 0) * scale;
    if (Number.isFinite(value)) found.add(quantityKey(value, suffix === 'percent' ? 'percent' : 'count'));
  }
  for (const match of text.matchAll(SMALL_SPELLED_QUANTITY)) {
    // "two million" must count as 2,000,000 only, never as both 2 and
    // 2,000,000; otherwise equivalent digit forms would be rejected.
    if (scaledSpans.some(([start, end]) => match.index < end && match.index + match[0].length > start)) continue;
    const value = match[0].toLowerCase().replace(/-/g, ' ').split(/\s+/)
      .reduce((sum, word) => sum + (WORD_VALUES[word] ?? 0), 0);
    if (value > 0) found.add(quantityKey(value, 'count'));
  }
  // A bare "one" is usually a request ("show one example"). Only recognize
  // it as an asserted quantity when directly attached to a known count noun.
  for (const match of text.matchAll(COUNTED_PHRASE)) {
    if (match[1]!.toLowerCase() === 'one') found.add(quantityKey(1, 'count'));
  }
  return found;
}

/** Recognized count nouns are checked per quantity, not across the whole FAQ. */
function countedUnits(text: string): Map<string, Set<string>> {
  const units = new Map<string, Set<string>>();
  for (const match of text.matchAll(COUNTED_PHRASE)) {
    const count = match[1]!.toLowerCase() === 'one'
      ? quantityKey(1, 'count')
      : [...quantities(match[1]!)].find(value => value.startsWith('count:'));
    if (!count) continue;
    const noun = match[2]!.toLowerCase();
    const unit = noun === 'people' ? 'person' : noun.endsWith('s') ? noun.slice(0, -1) : noun;
    const current = units.get(count) ?? new Set<string>();
    current.add(unit);
    units.set(count, current);
  }
  return units;
}

// A matching number alone cannot support an asserted range or approximation:
// "over 90" and "90" are different claims. Require the same authored
// comparison class and quantity, otherwise withhold the optional suggestion.
// This deliberately abstains on some mathematically entailed variants too.
const COMPARISON_KINDS: Readonly<Record<string, string>> = {
  'more than': 'gt', 'greater than': 'gt', over: 'gt', above: 'gt',
  'at least': 'gte', 'no less than': 'gte',
  'less than': 'lt', 'fewer than': 'lt', under: 'lt', below: 'lt',
  'at most': 'lte', 'no more than': 'lte', 'up to': 'lte',
  approximately: 'approx', roughly: 'approx', around: 'approx', about: 'approx',
  nearly: 'near-lt', almost: 'near-lt',
};
const COMPARED_QUANTITY = new RegExp(
  `\\b(${Object.keys(COMPARISON_KINDS).sort((a, b) => b.length - a.length).join('|')})[\\s-]+(${COUNTED_NUMBER}(?:\\s*(?:%|percent))?)(?![\\p{L}\\p{N}])`, 'giu',
);
// Recruiter job requirements commonly use "5+ years" or "20K+ users".
// A bare "5 years" FAQ must not validate this minimum claim.
const SUFFIX_AT_LEAST_QUANTITY = new RegExp(
  `\\b(${COUNTED_NUMBER})\\s*\\+(?![\\p{L}\\p{N}+])`, 'giu',
);
// Symbolic recruiter requirements (>=5 years, ≥20K users, <90% uptime)
// assert a range, not the exact observed value. Normalize to the same
// comparison classes as the written phrases; this is not entailment.
const SYMBOLIC_COMPARISON_KINDS: Readonly<Record<string, string>> = {
  '>': 'gt', '>=': 'gte', '≥': 'gte', '<': 'lt', '<=': 'lte', '≤': 'lte',
};
const SYMBOLIC_COMPARED_QUANTITY = new RegExp(
  `(>=|<=|≥|≤|>|<)\\s*(${COUNTED_NUMBER}(?:\\s*(?:%|percent))?)(?![\\p{L}\\p{N}])`, 'giu',
);
function comparedQuantities(text: string): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const match of text.matchAll(COMPARED_QUANTITY)) {
    const kind = COMPARISON_KINDS[match[1]!.toLowerCase()];
    if (!kind) continue;
    const counts = quantities(match[2]!);
    // The isolated word "one" is normally exempt, but not in "over one".
    if (match[2]!.toLowerCase() === 'one') counts.add(quantityKey(1, 'count'));
    for (const count of counts) {
      const kinds = result.get(count) ?? new Set<string>();
      kinds.add(kind);
      result.set(count, kinds);
    }
  }
  for (const match of text.matchAll(SYMBOLIC_COMPARED_QUANTITY)) {
    const kind = SYMBOLIC_COMPARISON_KINDS[match[1]!];
    if (!kind) continue;
    const counts = quantities(match[2]!);
    // Standalone "one" still represents a quantity after a comparison sign.
    if (match[2]!.toLowerCase() === 'one') counts.add(quantityKey(1, 'count'));
    for (const count of counts) {
      const kinds = result.get(count) ?? new Set<string>();
      kinds.add(kind);
      result.set(count, kinds);
    }
  }
  for (const match of text.matchAll(SUFFIX_AT_LEAST_QUANTITY)) {
    const counts = quantities(match[1]!);
    if (match[1]!.toLowerCase() === 'one') counts.add(quantityKey(1, 'count'));
    for (const count of counts) {
      const kinds = result.get(count) ?? new Set<string>();
      kinds.add('gte');
      result.set(count, kinds);
    }
  }
  return result;
}
/** True when a numeric premise is absent from the model-selected authored FAQ. */
export function hasUnsupportedQuantifiedPremise(question: string, faq: QuantifiedFaq): boolean {
  const asserted = quantities(question);
  if (asserted.size === 0) return false;
  const authoredText = [...faq.questions, faq.answer].join(' ');
  const authored = quantities(authoredText);
  if ([...asserted].some(value => !authored.has(value))) return true;
  const authoredComparisons = comparedQuantities(authoredText);
  if ([...comparedQuantities(question)].some(([count, kinds]) =>
    [...kinds].some(kind => !authoredComparisons.get(count)?.has(kind)))) return true;
  const authoredUnits = countedUnits(authoredText);
  return [...countedUnits(question)].some(([count, units]) =>
    [...units].some(unit => !authoredUnits.get(count)?.has(unit)));
}

// An authored FAQ about a topic does not substantiate a universal promise.
// Keep this independent from numeric guards: "every outage" and "never failed"
// carry factual absolutes without necessarily containing a number.
// Matching words only permit a related *authored* answer to be shown;
// they never establish that an external source actually supports the promise.
const ABSOLUTE_MARKER = /\b(?:all|every|always|never|permanent(?:ly)?|guarantee(?:d|s)?)\b/gi;
function absoluteMarkers(text: string): Set<string> {
  return new Set([...text.matchAll(ABSOLUTE_MARKER)].map(match => {
    const word = match[0]!.toLowerCase();
    return word.startsWith('guarantee') ? 'guarantee' : word.startsWith('permanent') ? 'permanent' : word;
  }));
}
export function hasUnsupportedAbsolutePremise(question: string, faq: QuantifiedFaq): boolean {
  const asserted = absoluteMarkers(question);
  if (asserted.size === 0) return false;
  const authored = absoluteMarkers([...faq.questions, faq.answer].join(' '));
  return [...asserted].some(word => !authored.has(word));
}
