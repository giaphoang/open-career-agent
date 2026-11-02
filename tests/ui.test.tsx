// @vitest-environment jsdom
import { act } from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import rawProfile from './fixtures/sample-profile.json';

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
vi.mock('../src/data/profile.json', async () => ({ default: (await import('./fixtures/sample-profile.json')).default }));
const wasm = vi.hoisted(() => ({ create: vi.fn(), select: vi.fn(), dispose: vi.fn() }));
vi.mock('../src/wasm-search', () => ({ createWasmSearch: wasm.create }));
const native = vi.hoisted(() => ({
  availability: vi.fn(async () => 'available'),
  select: vi.fn(),
  dispose: vi.fn(),
  enable: vi.fn(),
}));
vi.mock('../src/browser-llm', () => ({
  getNativeModelAvailability: native.availability,
  enableNativeModel: native.enable,
}));

it('supports evidence chat, guided role discovery, skill lookup, and clearing during a delayed model result', async () => {
  native.enable.mockResolvedValue({ select: native.select, dispose: native.dispose });
  wasm.create.mockResolvedValue({ select: wasm.select, dispose: wasm.dispose });
  const storageWrite = vi.spyOn(Storage.prototype, 'setItem');
  document.body.innerHTML = '<div id="root"></div>';
  Element.prototype.scrollIntoView = vi.fn();
  await act(async () => { await import('../src/main'); });
  // Recruiters see the interview first; cloning and model diagnostics come last.
  expect(document.querySelector('.demo-banner')?.textContent).toMatch(/fictional candidate.*not verified evidence/i);
  const workspace = document.querySelector('.workspace')!;
  expect(workspace.firstElementChild?.classList.contains('chat-card')).toBe(true);
  const developer = document.getElementById('for-developers')!;
  const experience = document.getElementById('experience')!;
  expect(Boolean(experience.compareDocumentPosition(developer) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  expect(developer.querySelector('.studio-section')).toBeTruthy();
  expect(developer.querySelector('.model-panel')).toBeTruthy();
  expect(developer.querySelector('.performance-panel')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Ask about experience' })).toBeTruthy();
  const skip = screen.getByRole('link', { name: 'Skip to interview chat' });
  expect(skip.getAttribute('href')).toBe('#conversation');
  expect(document.querySelector('#root')?.firstElementChild).toBe(skip);
  fireEvent.click(skip);
  expect(document.activeElement?.id).toBe('question');
  const firstFaq = rawProfile.faq[0]!;
  // The single-click example must show the authored answer and its evidence.
  fireEvent.click(screen.getByRole('button', { name: /See an example answer with sources/ }));
  expect(screen.getByText(firstFaq.answer)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Clear chat' }));
  fireEvent.click(screen.getByRole('button', { name: new RegExp(firstFaq.questions[0]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }));
  expect(screen.getByText(firstFaq.answer)).toBeTruthy();
  const firstSource = rawProfile.evidence.find(item => firstFaq.evidenceIds.includes(item.id))!;
  expect(screen.getAllByRole('link', { name: /DEMO PLACEHOLDER — NOT VERIFIED/ })).not.toHaveLength(0);
  expect(screen.getAllByRole('link', { name: new RegExp(firstSource.label) }).some(link => link.getAttribute('href') === firstSource.url)).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Clear chat' }));
  expect(screen.queryByText(firstFaq.answer)).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: /Discuss the role/ }));
  expect(screen.getByText('What role are you hiring for?')).toBeTruthy();
  const reply = async (value: string) => {
    const field = screen.getByLabelText('Answer the role question');
    fireEvent.change(field, { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
  };
  await reply('Staff backend engineer');
  expect(screen.getByText('Which technologies or stack matter for this role?')).toBeTruthy();
  await reply(rawProfile.skills[0]!.name);
  expect(screen.getByText('What scale or workload should the candidate expect?')).toBeTruthy();
  await reply('skip');
  expect(screen.getByText('Which outcomes or priorities matter most?')).toBeTruthy();
  await reply('reliability');
  expect(screen.getByText(/This is not a fit assessment/)).toBeTruthy();
  expect(screen.getByLabelText('Ask a question about the portfolio')).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: /Find evidence/ }));
  const picker = document.getElementById('skill-picker')!;
  fireEvent.click(within(picker).getByRole('button', { name: new RegExp(rawProfile.skills[0]!.name) }));
  expect(screen.getByText(/Public profile matches:/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Clear chat' }));
  expect(screen.queryByText(/Public profile matches:/)).toBeNull();
  expect(screen.queryByText('Staff backend engineer')).toBeNull();

  fireEvent.click(screen.getByText(/For developers · Clone this template/));
  expect((document.querySelector('.developer-tools') as HTMLDetailsElement).open).toBe(true);
  fireEvent.click(screen.getByText(/Optional on-device search/));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Enable on-device model' }).hasAttribute('disabled')).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Enable on-device model' }));
  await screen.findByRole('button', { name: 'Turn off model' });
  const privateField = screen.getByLabelText('Ask a question about the portfolio');
  fireEvent.change(privateField, { target: { value: 'What is your salary?' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
  expect(screen.getByText(/only discuss information the candidate chose to publish/i)).toBeTruthy();
  expect(native.select).not.toHaveBeenCalled();
  // A semantic model may choose "leadership" for an unsupported 1,000-person
  // management claim. The UI must not turn that choice into a suggested FAQ.
  native.select.mockResolvedValueOnce(2);
  fireEvent.change(privateField, { target: { value: 'Did you manage one thousand developers on the example project?' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(native.select).toHaveBeenCalledOnce();
  expect(screen.queryByText(/Related information from the public profile/)).toBeNull();

  // Compact numeric suffixes must receive the same fail-closed protection.
  native.select.mockResolvedValueOnce(2);
  fireEvent.change(privateField, { target: { value: 'Did you manage 100K engineers?' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(native.select).toHaveBeenCalledTimes(2);
  expect(screen.queryByText(/Related information from the public profile/)).toBeNull();

  // A related runbook FAQ must never imply universal outage prevention.
  native.select.mockResolvedValueOnce(14);
  fireEvent.change(privateField, { target: { value: 'Did your runbook eliminate every outage permanently?' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(native.select).toHaveBeenCalledTimes(3);
  expect(screen.queryByText(/Related information from the public profile/)).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Clear chat' }));
  let resolveSelection!: (value: number) => void;
  native.select.mockImplementation(() => new Promise<number>(resolve => { resolveSelection = resolve; }));
  const field = screen.getByLabelText('Ask a question about the portfolio');
  fireEvent.change(field, { target: { value: 'Have you won a Nobel Prize?' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
  expect(native.select).toHaveBeenCalledTimes(4);
  expect(screen.getByText('Have you won a Nobel Prize?')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Clear chat' }));
  expect((native.select.mock.calls[3]![2] as AbortSignal).aborted).toBe(true);
  await act(async () => { resolveSelection(0); await Promise.resolve(); });
  expect(screen.queryByText('Have you won a Nobel Prize?')).toBeNull();
  expect(screen.queryByText(/Related information from the public profile/)).toBeNull();
  expect(storageWrite).not.toHaveBeenCalled();
  expect(wasm.create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Turn off model' }));
  await screen.findByRole('button', { name: 'Enable on-device model' });
  fireEvent.click(screen.getByRole('button', { name: 'Enable WASM search' }));
  await screen.findByRole('button', { name: 'Turn off WASM search' });
  expect(wasm.create).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Enable on-device model' }).hasAttribute('disabled')).toBe(true);
  let resolveWasm!: (value: number) => void;
  wasm.select.mockImplementation(() => new Promise<number>(resolve => { resolveWasm = resolve; }));
  fireEvent.change(screen.getByLabelText('Ask a question about the portfolio'), { target: { value: 'Were you a professional astronaut?' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
  expect(wasm.select).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Clear chat' }));
  expect((wasm.select.mock.calls[0]![2] as AbortSignal).aborted).toBe(true);
  await act(async () => { resolveWasm(0); await Promise.resolve(); });
  expect(screen.queryByText('Were you a professional astronaut?')).toBeNull();
  expect(screen.queryByText(/Related information from the public profile/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Turn off WASM search' }));
  expect(wasm.dispose).toHaveBeenCalledOnce();

  // Real worker shutdown calls onClosed synchronously when a pending request is aborted.
  // Turning the provider off must retain the active instance through that callback.
  wasm.create.mockImplementation(async (options: { onClosed: () => void }) => {
    let closed = false;
    const close = () => { if (!closed) { closed = true; options.onClosed(); } };
    wasm.select.mockImplementation((_question, _faq, signal: AbortSignal) => new Promise<number | null>(resolve => {
      signal.addEventListener('abort', () => { close(); resolve(null); }, { once: true });
    }));
    wasm.dispose.mockImplementation(close);
    return { select: wasm.select, dispose: wasm.dispose };
  });
  fireEvent.click(screen.getByRole('button', { name: 'Enable WASM search' }));
  await screen.findByRole('button', { name: 'Turn off WASM search' });
  fireEvent.change(screen.getByLabelText('Ask a question about the portfolio'), { target: { value: 'Have you won a prize?' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
  fireEvent.click(screen.getByRole('button', { name: 'Turn off WASM search' }));
  await waitFor(() => expect(wasm.dispose).toHaveBeenCalledTimes(2));
  expect(screen.getByRole('button', { name: 'Enable WASM search' })).toBeTruthy();
  storageWrite.mockRestore();
});
