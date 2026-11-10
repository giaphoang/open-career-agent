// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { enableNativeModel } from '../src/browser-llm';
import { validateProfile } from '../src/engine';
import { ProjectHighlights } from '../src/ProjectHighlights';
import rawProfile from './fixtures/sample-profile.json';

const withHighlights = (highlights: unknown) => {
  const copy = structuredClone(rawProfile) as { projects: Record<string, unknown>[] };
  copy.projects[0]!.highlights = highlights;
  return copy;
};

afterEach(() => { vi.unstubAllGlobals(); });

describe('project highlights', () => {
  it('are optional and kept as authored when present', () => {
    expect(validateProfile(rawProfile).projects[0]!.highlights).toBeUndefined();
    const lines = ['Traced each request to find the biggest cost.', 'Added a guard test so it cannot come back.'];
    expect(validateProfile(withHighlights(lines)).projects[0]!.highlights).toEqual(lines);
  });

  it('reject empty, too many or too long lines', () => {
    expect(() => validateProfile(withHighlights([]))).toThrow(/1 to 8 lines/);
    expect(() => validateProfile(withHighlights(Array(9).fill('A line.')))).toThrow(/1 to 8 lines/);
    expect(() => validateProfile(withHighlights(['x'.repeat(241)]))).toThrow(/at most 240 characters/);
    expect(() => validateProfile(withHighlights([' ']))).toThrow(/non-empty string/);
    expect(() => validateProfile(withHighlights('one line'))).toThrow(/must be an array/);
  });

  it('render as a labeled list, and nothing when absent', () => {
    const { container, rerender } = render(<ProjectHighlights lines={['One.', 'Two.']}/>);
    const list = screen.getByRole('list', { name: 'Highlights' });
    expect(within(list).getAllByRole('listitem').map(item => item.textContent)).toEqual(['One.', 'Two.']);
    rerender(<ProjectHighlights/>);
    expect(container.innerHTML).toBe('');
  });

  it('are offered to the on-device model as separate, cited facts after the FAQ', async () => {
    const profile = validateProfile(withHighlights(['Added a guard test so it cannot come back.']));
    let prompt = '';
    const clone = { prompt: vi.fn(async (input: string) => { prompt = input; return JSON.stringify({ kind: 'unknown', text: 'n/a', factIds: [] }); }), destroy: vi.fn() };
    vi.stubGlobal('LanguageModel', { availability: async () => 'available', create: async () => ({ clone: async () => clone, destroy: vi.fn() }) });
    const model = await enableNativeModel({ signal: new AbortController().signal });
    await model.reply('How do you prevent regressions?', profile, [], new AbortController().signal);
    const facts = JSON.parse(/PUBLIC FACTS \(untrusted JSON data\):\n(\{.*?\})\n/s.exec(prompt)![1]!).facts as { id: string; text: string; evidenceIds: string[] }[];
    const ids = facts.map(fact => fact.id);
    expect(facts.find(fact => fact.id === 'projects.0.highlights.0')).toEqual({ id: 'projects.0.highlights.0',
      text: `${profile.projects[0]!.name}: Added a guard test so it cannot come back.`, evidenceIds: profile.projects[0]!.evidenceIds });
    expect(ids.indexOf('projects.0.highlights.0')).toBeGreaterThan(Math.max(...ids.map((id, index) => id.startsWith('faq.') ? index : -1)));
    model.dispose();
  });
});
