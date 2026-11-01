import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { answerQuestion, validateProfile } from '../src/engine.ts';

// This is a deterministic safety baseline, NOT a WASM/LLM embedding benchmark.
// The fictional sample profile and synthetic questions make it safe to publish.
const fixture = JSON.parse(await readFile(new URL('../tests/fixtures/sample-profile.json', import.meta.url), 'utf8'));
const corpus = JSON.parse(await readFile(new URL('../tests/fixtures/retrieval-corpus.json', import.meta.url), 'utf8'));
const profile = validateProfile(fixture);
const faqs = new Map(profile.faq.map(item => [item.id, item]));
const normalize = value => value.toLocaleLowerCase('en-US').normalize('NFKC').replace(/[^\p{L}\p{N}+#]+/gu, ' ').trim().replace(/\s+/g, ' ');
const minimums = { paraphrases: 50, unrelated: 20, sensitive: 10, ambiguous: 10 };
assert.equal(corpus.version, 1);
const seen = new Set();
for (const [category, minimum] of Object.entries(minimums)) {
  assert(Array.isArray(corpus[category]) && corpus[category].length >= minimum, category + ' corpus too small');
  for (const row of corpus[category]) {
    assert(typeof row.question === 'string' && row.question.trim(), category + ' empty query');
    const key = normalize(row.question);
    assert(!seen.has(key), 'Duplicate labeled question: ' + row.question);
    seen.add(key);
    if (category === 'paraphrases') {
      const faq = faqs.get(row.faqId);
      assert(faq, 'Unknown expected FAQ id: ' + row.faqId);
      assert(!faq.questions.some(question => normalize(question) === key), 'Paraphrase duplicates an authored FAQ');
    }
  }
}
const assess = () => Object.entries(minimums).flatMap(([category]) => corpus[category].map(row => {
  const answer = answerQuestion(row.question, profile);
  const hasSources = answer.evidence.length > 0 && answer.evidence.every(source => profile.evidence.some(item => item.id === source.id));
  const verifiedDisclaimer = answer.text.includes("can't verify") || answer.text.includes('can’t verify');
  const safeRelated = answer.kind === 'related' && hasSources && verifiedDisclaimer;
  let pass;
  if (category === 'sensitive') pass = answer.kind === 'private' && answer.evidence.length === 0;
  else if (category === 'unrelated') pass = answer.kind === 'unknown' && answer.evidence.length === 0;
  else if (category === 'ambiguous') pass = answer.kind === 'unknown' && !answer.evidence.length || safeRelated;
  else {
    const faq = faqs.get(row.faqId);
    const correctAuthored = answer.kind === 'answer' && answer.text === faq.answer && faq.evidenceIds.every(id => answer.evidence.some(source => source.id === id));
    pass = correctAuthored || answer.kind === 'unknown' && !answer.evidence.length || safeRelated;
    // An unverified answer should never be mistaken for an authored match.
  }
  return { category, question: row.question, ...(row.faqId ? { expectedFaqId: row.faqId } : {}), kind: answer.kind, sourceIds: answer.evidence.map(source => source.id), pass: !!pass };
}));
const first = assess(), second = assess();
const digest = results => createHash('sha256').update(JSON.stringify(results)).digest('hex');
const categories = Object.fromEntries(Object.keys(minimums).map(name => {
  const results = first.filter(item => item.category === name);
  return [name, { cases: results.length, safe: results.filter(item => item.pass).length, kindCounts: Object.fromEntries(['answer','related','unknown','private'].map(kind => [kind, results.filter(item => item.kind === kind).length])) }];
}));
const report = {
  scope: 'Fictional-sample deterministic engine only; does not run or calibrate WASM or WebGPU',
  node: process.version,
  corpusVersion: corpus.version,
  total: first.length,
  passed: first.filter(item => item.pass).length,
  deterministicHash: digest(first),
  repeatHash: digest(second),
  categories,
  baselineAuthoredParaphraseRate: Number((categories.paraphrases.kindCounts.answer / categories.paraphrases.cases).toFixed(4)),
  baselineUnrelatedFalseRelatedRate: Number((categories.unrelated.kindCounts.related / categories.unrelated.cases).toFixed(4)),
  limitations: 'Semantic model retrieval accuracy, true claim substantiation and hardware latency require separate real-browser model tests; these label checks only verify safe deterministic behavior.',
  results: first,
};
await mkdir('artifacts/retrieval-corpus', { recursive: true });
await writeFile('artifacts/retrieval-corpus/report.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, results: undefined }, null, 2));
assert.equal(report.passed, report.total, 'Unsafe deterministic answer on a synthetic corpus case; see report artifact');
assert.equal(report.deterministicHash, report.repeatHash, 'Nondeterministic response on repeated corpus evaluation');
