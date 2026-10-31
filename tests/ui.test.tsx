// @vitest-environment jsdom
import { act } from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import rawProfile from '../src/data/profile.json';

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
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
  const firstFaq = rawProfile.faq[0]!;
  fireEvent.click(screen.getByRole('button', { name: new RegExp(firstFaq.questions[0]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }));
  expect(screen.getByText(firstFaq.answer)).toBeTruthy();
  const firstSource = rawProfile.evidence.find(item => firstFaq.evidenceIds.includes(item.id))!;
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

  fireEvent.click(screen.getByText(/Optional on-device search/));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Enable on-device model' }).hasAttribute('disabled')).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Enable on-device model' }));
  await screen.findByRole('button', { name: 'Turn off model' });
  const privateField = screen.getByLabelText('Ask a question about the portfolio');
  fireEvent.change(privateField, { target: { value: 'What is your salary?' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
  expect(screen.getByText(/only discuss information the candidate chose to publish/i)).toBeTruthy();
  expect(native.select).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Clear chat' }));
  let resolveSelection!: (value: number) => void;
  native.select.mockImplementation(() => new Promise<number>(resolve => { resolveSelection = resolve; }));
  const field = screen.getByLabelText('Ask a question about the portfolio');
  fireEvent.change(field, { target: { value: 'Have you won a Nobel Prize?' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
  expect(native.select).toHaveBeenCalledOnce();
  expect(screen.getByText('Have you won a Nobel Prize?')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Clear chat' }));
  expect((native.select.mock.calls[0]![2] as AbortSignal).aborted).toBe(true);
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
