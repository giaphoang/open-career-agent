// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CandidateStudio, createStarterProfile } from '../src/CandidateStudio';
import { validateProfile } from '../src/engine';

const draft = {
  name: 'Taylor Example', headline: 'Java engineer', location: 'Remote', summary: 'Built an order service.', availability: 'Open to discussions', contact: 'taylor@example.com',
  sourceLabel: 'Public project', sourceUrl: 'https://github.com/tuannx/open-career-agent', projectName: 'Orders', projectRole: 'Engineer', projectSummary: 'Built an order service.', stack: 'Java, PostgreSQL, java',
  question: 'What Java work have you done?', answer: 'I built an order service.', followUp: 'What is your workload?',
};
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('creates a schema-valid, entirely explicit starter with supporting references', () => {
  const result = createStarterProfile(draft);
  expect(result.kind).toBe('ok');
  if (result.kind !== 'ok') return;
  expect(() => validateProfile(result.profile)).not.toThrow();
  expect(result.profile.skills.map(skill => skill.name)).toEqual(['Java', 'PostgreSQL']);
  expect(result.profile.projects[0]?.evidenceIds).toEqual(['source-1']);
  expect(result.profile.candidate.headlineEvidenceIds).toEqual(['source-1']);
  expect(result.profile.faq[0]?.answer).toBe(draft.answer);
  expect(result.profile.timeline).toEqual([]);
  expect(JSON.stringify(result.profile)).not.toContain('Alex Morgan');
  const symbolSkill = createStarterProfile({ ...draft, stack: 'C++, C#' });
  expect(symbolSkill.kind).toBe('ok');
  if (symbolSkill.kind === 'ok') expect(symbolSkill.profile.skills.map(skill => skill.name)).toEqual(['C++', 'C#']);
});

it('rejects missing fields and unsafe or credential-bearing links', () => {
  expect(createStarterProfile({ ...draft, answer: '  ' }).kind).toBe('invalid');
  expect(createStarterProfile({ ...draft, sourceUrl: 'javascript:alert(1)' }).kind).toBe('invalid');
  expect(createStarterProfile({ ...draft, sourceUrl: 'https://docs.example.org/case-study' })).toMatchObject({ kind: 'invalid', message: expect.stringContaining('not public evidence') });
  for (const sourceUrl of ['https://example.com./work', 'https://docs.example.test/work', 'https://service.invalid/work', 'https://localhost/work',
    'https://127.0.0.1/work', 'https://192.168.1.10/work', 'https://[::1]/work', 'https://2130706433/work',
    'https://docs.private.local/work', 'https://hr.internal/work', 'https://nas.home.arpa/work',
    'https://portfolio.alt/work', 'https://service.onion/work', 'https://intranet/work']) {
    expect(createStarterProfile({ ...draft, sourceUrl }), sourceUrl).toMatchObject({ kind: 'invalid', message: expect.stringContaining('not public evidence') });
  }
  expect(createStarterProfile({ ...draft, sourceUrl: 'https://user:password@example.org/private' }).kind).toBe('invalid');
  expect(createStarterProfile({ ...draft, stack: ', , ' }).kind).toBe('invalid');
  expect(createStarterProfile({ ...draft, question: 'What salary did the project cost?' })).toMatchObject({ kind: 'invalid', message: expect.stringContaining('privacy guard') });
});

it('requires an explicit public evidence review before a local download, with no network or storage writes', () => {
  const fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
  const xhrSend = vi.spyOn(XMLHttpRequest.prototype, 'send');
  const storageWrite = vi.spyOn(Storage.prototype, 'setItem');
  const createUrl = vi.fn(() => 'blob:test');
  const revoke = vi.fn();
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: revoke }));
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  render(<CandidateStudio onClose={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(screen.getByRole('alert').textContent).toContain('Public name');
  const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fill('Public name', draft.name); fill('Public professional headline', draft.headline); fill('Public location', draft.location); fill('Availability', draft.availability); fill('Public contact email', draft.contact); fill('Public summary', draft.summary);
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  fill('Evidence label', draft.sourceLabel); fill('Public HTTPS evidence URL', draft.sourceUrl); fill('Project name', draft.projectName); fill('Your role on the project', draft.projectRole); fill('Your documented project contribution', draft.projectSummary); fill('Project skills or technologies, separated by commas', draft.stack);
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  fill('Recruiter question', draft.question); fill('Evidence-backed answer', draft.answer); fill('Question to ask the recruiter', draft.followUp);
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(screen.getByRole('link', { name: /Open your evidence/ }).getAttribute('href')).toBe(draft.sourceUrl);
  fireEvent.click(screen.getByRole('button', { name: 'Download profile.json' }));
  expect(screen.getByRole('alert').textContent).toContain('Confirm');
  expect(createUrl).not.toHaveBeenCalled();
  const checks = screen.getAllByRole('checkbox');
  expect(checks).toHaveLength(6);
  fireEvent.click(checks[0]!);
  fireEvent.click(screen.getByRole('button', { name: 'Download profile.json' }));
  expect(createUrl).not.toHaveBeenCalled();
  for (const checkbox of checks.slice(1)) fireEvent.click(checkbox);
  fireEvent.click(screen.getByRole('button', { name: 'Download profile.json' }));
  expect(click).toHaveBeenCalledOnce();
  expect(createUrl).toHaveBeenCalledOnce();
  expect(screen.getByRole('status').textContent).toContain('does not update the website');
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(xhrSend).not.toHaveBeenCalled();
  expect(storageWrite).not.toHaveBeenCalled();
});
