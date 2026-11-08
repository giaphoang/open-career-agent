// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { BuiltWith } from '../src/BuiltWith';

it('lists the features this template really ships, with a labeled heading', () => {
  render(<BuiltWith/>);
  const section = screen.getByRole('region', { name: /built with care/i });
  const items = within(section).getAllByRole('listitem').map(item => item.querySelector('strong')?.textContent);
  expect(items).toEqual(['Answers with sources', 'Works offline', 'On-device AI (optional)',
    'Semantic search in WebAssembly (optional)', 'Private job match', 'Search, share and print ready']);
  expect(within(section).getByRole('link', { name: /open-career-agent template/i }).getAttribute('rel')).toBe('noreferrer');
});
