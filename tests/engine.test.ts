import { describe, expect, it } from 'vitest';
import profileData from './fixtures/sample-profile.json';
import configuredProfile from '../src/data/profile.json';
import { advanceInterview, answerQuestion, isPlaceholderEvidenceUrl, searchCareer, startInterview, validateProfile } from '../src/engine';

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

  it('greets recruiters without citing evidence or swallowing substantive questions', () => {
    for (const greeting of ['Hi', 'hello!', 'Hey there', 'Good evening.', 'Xin chào', 'Chào!']) {
      const result = answerQuestion(greeting, profile);
      expect(result.kind, greeting).toBe('answer');
      expect(result.evidence, greeting).toEqual([]);
      expect(result.text, greeting).toMatch(/Ask about the candidate’s projects/);
    }
    expect(answerQuestion('Hello! Did Alex win a Nobel Prize?', profile)).toMatchObject({ kind: 'unknown', evidence: [] });
    expect(answerQuestion('Hello, what is your salary?', profile)).toMatchObject({ kind: 'private', evidence: [] });
  });

  it('provides only related evidence rather than affirming an unsupported claim', () => {
    const result = answerQuestion('Did you scale Java to a billion users?', profile);
    expect(result.kind).toBe('related');
    expect(result.text).toContain("can't verify");
    expect(result.text).not.toContain('billion');
    expect(result.evidence.map((source) => source.id)).toEqual(['orders']);
  });

  it('refuses age questions phrased without the word age and never returns sources', () => {
    for (const question of ['How old are you?', 'How old is the candidate?', 'When were you born?', 'What is your birth year?', 'What is your DOB?']) {
      expect(answerQuestion(question, profile), question).toMatchObject({ kind: 'private', evidence: [] });
    }
    const sensitiveFaq = structuredClone(profileData);
    sensitiveFaq.faq[0]!.questions = ['How old are you?'];
    expect(() => validateProfile(sensitiveFaq)).toThrow('FAQ questions cannot ask for private information');
  });

  it('refuses alternative private contact wording without disclosing evidence', () => {
    for (const question of [
      'Could I have your mobile number?',
      'What is your cell phone?',
      'What is your cellular number?',
      'What is your residential address?',
      'What is your mailing address?',
      'Could you share your email address?',
    ]) {
      expect(answerQuestion(question, profile), question).toMatchObject({ kind: 'private', evidence: [] });
      const edited = structuredClone(profileData);
      edited.faq[0]!.questions = [question];
      expect(() => validateProfile(edited), question).toThrow('FAQ questions cannot ask for private information');
    }
    // Do not accidentally block ordinary questions about technical work.
    for (const question of ['How did you address Java reliability?', 'Describe your mobile application architecture.']) {
      expect(answerQuestion(question, profile).kind, question).not.toBe('private');
    }
  });

  it('declines unknown and sensitive questions, even when they name a project', () => {
    expect(answerQuestion('Are you a Nobel Prize winner?', profile)).toMatchObject({ kind: 'unknown', evidence: [] });
    expect(answerQuestion('What is your salary on the Java project?', profile)).toMatchObject({ kind: 'private', evidence: [] });
    expect(answerQuestion('   ', profile)).toMatchObject({ kind: 'unknown', evidence: [] });
  });
});

describe('public profile validation', () => {
  it('rejects FAQ questions that the privacy guard would always refuse', () => {
    const profileWithBlockedQuestion = structuredClone(profileData);
    profileWithBlockedQuestion.faq[0]!.questions = ['What is your salary?'];
    expect(() => validateProfile(profileWithBlockedQuestion)).toThrow('FAQ questions cannot ask for private information');
  });
  it('accepts the configured public profile', () => {
    expect(() => validateProfile(configuredProfile)).not.toThrow();
  });
  it('allows reserved example URLs only for the explicitly fictional demo', () => {
    const renamed = structuredClone(profileData);
    renamed.candidate.name = 'Actual Candidate';
    expect(() => validateProfile(renamed)).toThrow(/Placeholder or IP-address evidence URLs/);
    const withRealUrls = structuredClone(renamed);
    withRealUrls.evidence = withRealUrls.evidence.map((source, index) =>
      ({ ...source, url: `https://github.com/tuannx/open-career-agent/tree/main/docs#source-${index}` }));
    expect(() => validateProfile(withRealUrls)).not.toThrow();
    const subdomain = structuredClone(withRealUrls);
    subdomain.evidence[0]!.url = 'https://docs.example.org/sample';
    expect(() => validateProfile(subdomain)).toThrow(/Placeholder or IP-address evidence URLs/);
  });

  it('rejects reserved documentation, test and local hosts, including root-dot variants', () => {
    const reserved = [
      'https://example.com./work', 'https://docs.example.org./case',
      'https://example./doc', 'https://docs.example.test/work',
      'https://service.invalid/work', 'https://localhost/work',
      'https://project.dev.localhost/work',
      'https://127.0.0.1/work', 'https://192.168.1.10/work',
      'https://[::1]/work', 'https://2130706433/work',
      'https://8.8.8.8/work',
      'https://docs.private.local/work', 'https://printer.local./proof',
      'https://hr.internal/verification', 'https://portal.internal./work',
      'https://nas.home.arpa/cv', 'https://service.onion/proof',
      'https://portfolio.alt/case', 'https://intranet/work',
      'https://intranet./work',
    ];
    for (const url of reserved) {
      expect(isPlaceholderEvidenceUrl(url), url).toBe(true);
      const candidate = structuredClone(profileData);
      candidate.candidate.name = 'Real Candidate';
      candidate.evidence[0]!.url = url;
      expect(() => validateProfile(candidate), url).toThrow(/Placeholder or IP-address evidence URLs/);
    }
    for (const url of ['https://github.com/tuannx/open-career-agent', 'https://notexample.org/work', 'https://example.com.evil.org/work', 'https://test.dev/work', 'https://local-business.com/work', 'https://internal-review.dev/work']) {
      expect(isPlaceholderEvidenceUrl(url), url).toBe(false);
    }
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

describe('structured evidence search', () => {
  it('returns matching public skills and projects with their sources', () => {
    const result = searchCareer('Java', profile);
    expect(result.skills.map((skill) => skill.name)).toEqual(['Java']);
    expect(result.projects.map((project) => project.name)).toEqual(['Order Service', 'Event Pipeline']);
    expect(result.evidence.map((source) => source.id)).toEqual(['orders', 'events']);
  });

  it('does not match partial names or invent unsupported skills', () => {
    expect(searchCareer('JavaScript', profile)).toEqual({ skills: [], projects: [], evidence: [] });
    expect(searchCareer('Kubernetes', profile)).toEqual({ skills: [], projects: [], evidence: [] });
    const withShortTerms = structuredClone(profile);
    withShortTerms.skills.push({ name: 'Go', category: 'Languages', evidenceIds: ['orders'] });
    withShortTerms.skills.push({ name: 'R', category: 'Languages', evidenceIds: ['events'] });
    expect(searchCareer('Go and Java', withShortTerms).skills.map((skill) => skill.name)).toEqual(['Java', 'Go']);
    expect(searchCareer('R', withShortTerms).skills.map((skill) => skill.name)).toEqual(['R']);
    expect(searchCareer('R and Java', withShortTerms).skills.map((skill) => skill.name)).toEqual(['Java']);
  });

  it('answers the skills listing only with cited public skills', () => {
    const answer = answerQuestion('What skills do you have?', profile);
    expect(answer.kind).toBe('answer');
    expect(answer.text).toContain('Java');
    expect(answer.evidence.map((source) => source.id)).toEqual(['orders', 'events', 'dashboard']);
    expect(answerQuestion('Are you an expert in Kubernetes?', profile).kind).toBe('unknown');
  });
});

describe('reverse interview', () => {
  it('collects role, stack, scale and priorities in order and supports skipping', () => {
    const initial = startInterview();
    expect(initial.state.step).toBe('role');
    expect(initial.followUp).toMatch(/role/i);
    const role = advanceInterview(initial.state, 'Staff backend engineer');
    expect(role.state).toMatchObject({ step: 'stack', answers: { role: 'Staff backend engineer' } });
    expect(role.followUp).toMatch(/stack/i);
    const stack = advanceInterview(role.state, 'Java and PostgreSQL');
    expect(stack.state.step).toBe('scale');
    expect(searchCareer(stack.state.answers.stack ?? '', profile).projects.map((p) => p.id)).toEqual(['orders', 'events']);
    const scale = advanceInterview(stack.state, 'skip');
    expect(scale.state).toMatchObject({ step: 'priorities', answers: { scale: '' } });
    const done = advanceInterview(scale.state, 'reliability');
    expect(done.state.step).toBe('complete');
    expect(done.followUp).toBeUndefined();
    expect(advanceInterview(done.state, 'anything').state).toEqual(done.state);
  });

  it('rejects empty and oversized replies without advancing or retaining them', () => {
    const initial = startInterview();
    for (const reply of ['   ', 'x'.repeat(501)]) {
      const result = advanceInterview(initial.state, reply);
      expect(result.state).toEqual(initial.state);
      expect(result.followUp).toBe(initial.followUp);
      expect(result.state.answers).toEqual({});
    }
  });
});

describe('public data and candidate claim validation', () => {
  it('requires evidence for the headline and summary and resolves both independently', () => {
    const clean = structuredClone(profileData);
    const candidate = { ...clean.candidate, headlineEvidenceIds: ['orders'], summaryEvidenceIds: ['events'] };
    const validated = validateProfile({ ...clean, candidate });
    expect(validated.candidate.headlineEvidenceIds).toEqual(['orders']);
    expect(validated.candidate.summaryEvidenceIds).toEqual(['events']);
    for (const field of ['headlineEvidenceIds', 'summaryEvidenceIds'] as const) {
      expect(() => validateProfile({ ...clean, candidate: { ...candidate, [field]: [] } })).toThrow(field);
      expect(() => validateProfile({ ...clean, candidate: { ...candidate, [field]: ['missing'] } })).toThrow('Unknown evidence id');
      const withoutField: Record<string, unknown> = { ...candidate };
      delete withoutField[field];
      expect(() => validateProfile({ ...clean, candidate: withoutField })).toThrow(field);
    }
  });

  it('rejects unknown keys at the root and every nested public data object', () => {
    const candidate = { ...profileData.candidate, headlineEvidenceIds: ['orders'], summaryEvidenceIds: ['events'] };
    const clean = { ...structuredClone(profileData), candidate };
    expect(() => validateProfile(clean)).not.toThrow();
    expect(() => validateProfile({ ...clean, privateResume: 'secret' })).toThrow('profile.privateResume');
    expect(() => validateProfile({ ...clean, candidate: { ...candidate, privatePhone: 'secret' } })).toThrow('candidate.privatePhone');
    for (const section of ['skills', 'projects', 'timeline', 'evidence', 'faq'] as const) {
      const items = clean[section];
      const withExtra = [{ ...items[0], secret: 'private' }, ...items.slice(1)];
      expect(() => validateProfile({ ...clean, [section]: withExtra }), section).toThrow(`${section}[0].secret`);
    }
  });
});
