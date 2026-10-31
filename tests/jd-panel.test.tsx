// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { JobMatchPanel } from '../src/JobMatchPanel';
import { validateProfile } from '../src/engine';
import sample from './fixtures/sample-profile.json';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('explores pasted requirements locally, exposes evidence, and clears stale or private input', () => {
  const fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
  const xhrSend = vi.spyOn(XMLHttpRequest.prototype, 'send').mockImplementation(() => {});
  const storageWrite = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});
  const profile = validateProfile(sample);
  render(<JobMatchPanel profile={profile} />);
  fireEvent.click(screen.getByText(/Explore a job description/));
  const input = screen.getByLabelText('Job description') as HTMLTextAreaElement;
  const description = 'Java\nNo React required\nKubernetes';
  fireEvent.paste(input, { clipboardData: { getData: () => description } });
  // jsdom does not apply clipboard data to a textarea; emulate the browser input event.
  fireEvent.change(input, { target: { value: description } });
  fireEvent.click(screen.getByRole('button', { name: 'Find related evidence' }));

  const java = screen.getByText('Java', { selector: '.jd-snippet' }).closest('article')!;
  expect(within(java).getByText('Java', { selector: 'strong' })).toBeTruthy();
  const evidenceLink = within(java).getByRole('link', { name: /Order Service · example case study/ });
  expect(evidenceLink.getAttribute('href')).toBe('https://example.com/order-service');
  expect(within(java).getByText(/Order Service, Event Pipeline/)).toBeTruthy();

  const negated = screen.getByText('No React required').closest('article')!;
  expect(within(negated).getByText(/Review the context manually/)).toBeTruthy();
  expect(within(negated).queryByRole('link')).toBeNull();
  const unknown = screen.getByText('Kubernetes').closest('article')!;
  expect(within(unknown).getByText(/No public keyword identified/)).toBeTruthy();
  expect(within(unknown).queryByRole('link')).toBeNull();

  fireEvent.change(input, { target: { value: 'React' } });
  expect(screen.queryByText('Items to review')).toBeNull();
  expect(screen.queryByText('No React required')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Find related evidence' }));
  expect(screen.getByText('Items to review')).toBeTruthy();
  expect(screen.getByRole('link', { name: /Operations Dashboard · example case study/ })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
  expect(input.value).toBe('');
  expect(screen.queryByText('Items to review')).toBeNull();
  fireEvent.change(input, { target: { value: 'x'.repeat(8001) } });
  fireEvent.click(screen.getByRole('button', { name: 'Find related evidence' }));
  expect(screen.getByText(/at most 8,000 characters/)).toBeTruthy();
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(xhrSend).not.toHaveBeenCalled();
  expect(storageWrite).not.toHaveBeenCalled();
});
