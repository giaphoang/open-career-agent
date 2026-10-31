import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { answerQuestion, validateProfile } from '../src/engine.ts';

const profile = validateProfile(JSON.parse(readFileSync(new URL('../src/data/profile.json', import.meta.url), 'utf8')));
const sample = validateProfile(JSON.parse(readFileSync(new URL('../tests/fixtures/sample-profile.json', import.meta.url), 'utf8')));
const checks = profile.faq.flatMap(item => item.questions.map(question => ({ question, expected: 'answer', profile })));
checks.push({ question: 'What is your private salary?', expected: 'private', profile: sample });
checks.push({ question: 'Did you win the Nobel Prize for a trillion users?', expected: 'unknown', profile: sample });
const evaluate = () => checks.map(({ question, expected, profile: selectedProfile }) => {
  const answer = answerQuestion(question, selectedProfile);
  return { question, expected, actual: answer.kind, sources: answer.evidence.map(item => item.id).sort(), pass: answer.kind === expected && (expected !== 'answer' || answer.evidence.length > 0) };
});
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const first = evaluate(), second = evaluate();
const times = [];
for (let i = 0; i < 10000; i++) {
  const item = checks[i % checks.length];
  const start = performance.now();
  answerQuestion(item.question, item.profile);
  times.push(performance.now() - start);
}
times.sort((a, b) => a - b);
const summary = { checks: first.length, passed: first.filter(item => item.pass).length, deterministicHash: hash(first), repeatHash: hash(second), node: process.version,
  timing: { environment: 'Node.js process; engine only, not a browser or page-load benchmark', iterations: times.length, p95Milliseconds: Number(times[Math.floor(times.length * 0.95)].toFixed(4)) },
  limitations: 'Source IDs are checked; source truth, accessibility, browser latency and LCP are not evaluated.' };
console.log(JSON.stringify(summary, null, 2));
if (summary.passed !== summary.checks || summary.deterministicHash !== summary.repeatHash) process.exitCode = 1;
