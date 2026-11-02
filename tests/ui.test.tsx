// @vitest-environment jsdom
import { act } from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import rawProfile from './fixtures/sample-profile.json';
import type { NativeModel } from '../src/browser-llm';

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
vi.mock('../src/data/profile.json', async () => ({ default: (await import('./fixtures/sample-profile.json')).default }));
const wasm = vi.hoisted(() => ({ create: vi.fn(), select: vi.fn(), dispose: vi.fn() }));
vi.mock('../src/wasm-search', () => ({ createWasmSearch: wasm.create }));
const native = vi.hoisted(() => ({
  availability: vi.fn(async () => 'available'),
  reply: vi.fn(),
  dispose: vi.fn(),
  enable: vi.fn(),
}));
vi.mock('../src/browser-llm', () => ({
  getNativeModelAvailability: native.availability,
  enableNativeModel: native.enable,
}));

it('supports evidence chat, guided role discovery, skill lookup, and clearing during a delayed model result', async () => {
  native.enable.mockResolvedValue({ reply: native.reply, dispose: native.dispose });
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
  fireEvent.click(screen.getByText(/Optional on-device AI/));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Enable on-device model' }).hasAttribute('disabled')).toBe(false));
  let resolveNative!: (value: { reply: typeof native.reply; dispose: typeof native.dispose }) => void;
  let nativeStartup!: { signal: AbortSignal; onProgress: (fraction: number) => void };
  native.enable.mockImplementationOnce((options: typeof nativeStartup) => {
    nativeStartup = options;
    return new Promise(resolve => { resolveNative = resolve; });
  });
  fireEvent.click(screen.getByRole('button', { name: 'Enable on-device model' }));
  const modelSummary = document.querySelector('.model-panel summary')!;
  expect(modelSummary.textContent).toMatch(/LOADING/);
  const download = screen.getByRole('progressbar', { name: 'Chrome LLM API model download' });
  expect(download.getAttribute('value')).toBeNull();
  expect(download.getAttribute('max')).toBe('1');
  await act(async () => { nativeStartup.onProgress(0.22); });
  expect(modelSummary.textContent).toMatch(/DOWNLOADING 22%/);
  expect(download.getAttribute('value')).toBe('0.22');
  // Model downloads must not prevent the instant, evidence-backed interview.
  fireEvent.change(screen.getByLabelText('Ask a question about the portfolio'), { target: { value: firstFaq.questions[0] } });
  fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
  expect(screen.getByText(firstFaq.answer)).toBeTruthy();
  expect(native.reply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Clear chat' }));
  await act(async () => { nativeStartup.onProgress(1); });
  expect(download.getAttribute('value')).toBe('1');
  expect(modelSummary.textContent).toMatch(/STARTING/);
  expect(screen.getByText(/Chrome is preparing the model/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Turn off model' })).toBeNull();
  await act(async () => { resolveNative({ reply: native.reply, dispose: native.dispose }); });
  await screen.findByRole('button', { name: 'Turn off model' });
  expect(modelSummary.textContent).toMatch(/ON/);
  expect(screen.getByText('Chrome LLM API enabled for conversation using the public profile')).toBeTruthy();
  expect(screen.queryByRole('progressbar', { name: 'Chrome LLM API model download' })).toBeNull();
  const privateField = screen.getByLabelText('Ask a question about the portfolio');
  const askNative = (question: string) => {
    fireEvent.change(privateField, { target: { value: question } });
    fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
  };
  askNative('What is your salary?');
  expect(screen.getByText(/only discuss information the candidate chose to publish/i)).toBeTruthy();
  expect(native.reply).not.toHaveBeenCalled();

  // Role answers stay out of native conversation context and never trigger inference.
  fireEvent.click(screen.getByRole('button', { name: /Discuss the role/ }));
  await reply('Staff backend engineer');
  expect(screen.getByText('Which technologies or stack matter for this role?')).toBeTruthy();
  expect(native.reply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Stop role questions' }));

  // An exact FAQ match must still use the enabled native conversation provider.
  type NativeReply = Awaited<ReturnType<NativeModel['reply']>>;
  let resolveReply!: (value: NativeReply) => void;
  native.reply.mockImplementationOnce(() => new Promise<NativeReply>(resolve => { resolveReply = resolve; }));
  askNative(firstFaq.questions[0]!);
  expect(native.reply).toHaveBeenCalledOnce();
  expect(native.reply.mock.calls[0]![0]).toBe(firstFaq.questions[0]);
  expect(native.reply.mock.calls[0]![1]).toEqual(rawProfile);
  expect(native.reply.mock.calls[0]![2]).toEqual([]);
  expect(screen.getByText('Chrome LLM API is drafting a reply…')).toBeTruthy();
  const draft = { kind: 'answer' as const, text: 'Here is a draft based on the public profile.', evidence: [firstSource] };
  await act(async () => { resolveReply({ kind: 'answer', answer: draft, elapsedMs: 12 }); });
  expect(screen.getByText(draft.text)).toBeTruthy();
  expect(screen.getByText(/Chrome LLM API · AI DRAFT · CHECK SOURCES/)).toBeTruthy();
  expect(screen.queryByText('Chrome LLM API is drafting a reply…')).toBeNull();
  expect(screen.getAllByRole('link', { name: new RegExp(firstSource.label) }).some(link => link.getAttribute('href') === firstSource.url)).toBe(true);

  // The next turn receives public conversational context, never the salary refusal.
  const followUp = 'Could you explain that in simpler terms?';
  const secondDraft = { ...draft, text: 'This is a simpler description of the same public work.' };
  native.reply.mockResolvedValueOnce({ kind: 'answer', answer: secondDraft, elapsedMs: 8 });
  askNative(followUp);
  await screen.findByText(secondDraft.text);
  expect(native.reply.mock.calls[1]![2]).toEqual([{ question: firstFaq.questions[0], answer: draft.text }]);
  native.reply.mockResolvedValueOnce({ kind: 'answer', answer: { ...draft, text: 'Hello. What would you like to know about the public profile?' }, elapsedMs: 7 });
  askNative('Hello');
  await screen.findByText('Hello. What would you like to know about the public profile?');
  expect(native.reply.mock.calls[2]![2]).toEqual([
    { question: firstFaq.questions[0], answer: draft.text },
    { question: followUp, answer: secondDraft.text },
  ]);

  // Failed inference retains the authored answer and explains the visible fallback.
  native.reply.mockResolvedValueOnce({ kind: 'fallback', reason: 'error' });
  askNative(firstFaq.questions[0]!);
  await screen.findByText('Chrome LLM API could not reply. Showing the instant profile answer.');
  expect(screen.getByText(firstFaq.answer)).toBeTruthy();
  expect(native.reply.mock.calls[3]![2]).toHaveLength(3);
  expect(JSON.stringify(native.reply.mock.calls[3]![2])).not.toMatch(/salary/i);
  expect(screen.queryByText('Chrome LLM API is drafting a reply…')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Clear chat' }));

  native.reply.mockImplementationOnce(() => new Promise<NativeReply>(resolve => { resolveReply = resolve; }));
  askNative('Have you won a Nobel Prize?');
  expect(native.reply).toHaveBeenCalledTimes(5);
  expect(native.reply.mock.calls[4]![2]).toEqual([]);
  expect(screen.getByText('Have you won a Nobel Prize?')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Clear chat' }));
  expect((native.reply.mock.calls[4]![3] as AbortSignal).aborted).toBe(true);
  await act(async () => { resolveReply({ kind: 'answer', answer: draft, elapsedMs: 25 }); });
  expect(screen.queryByText('Have you won a Nobel Prize?')).toBeNull();
  expect(screen.queryByText(draft.text)).toBeNull();
  expect(screen.queryByText('Chrome LLM API is drafting a reply…')).toBeNull();
  expect(storageWrite).not.toHaveBeenCalled();
  expect(wasm.create).not.toHaveBeenCalled();

  // A new request cancels the earlier turn, without using its unfinished context.
  let resolveEarlierReply!: (value: NativeReply) => void;
  native.reply.mockImplementationOnce(() => new Promise<NativeReply>(resolve => { resolveEarlierReply = resolve; }));
  askNative('Have you worked as an astronaut?');
  native.reply.mockImplementationOnce(() => new Promise<NativeReply>(resolve => { resolveReply = resolve; }));
  askNative(firstFaq.questions[0]!);
  expect((native.reply.mock.calls[5]![3] as AbortSignal).aborted).toBe(true);
  expect(native.reply.mock.calls[6]![2]).toEqual([]);
  await act(async () => { resolveEarlierReply({ kind: 'answer', answer: { ...draft, text: 'This is a stale draft from the earlier request.' }, elapsedMs: 25 }); });
  expect(screen.queryByText('This is a stale draft from the earlier request.')).toBeNull();
  expect(screen.getByText('Chrome LLM API is drafting a reply…')).toBeTruthy();

  // Turning the provider off also aborts an active reply and discards its late result.
  fireEvent.click(screen.getByRole('button', { name: 'Turn off model' }));
  expect((native.reply.mock.calls[6]![3] as AbortSignal).aborted).toBe(true);
  await screen.findByRole('button', { name: 'Enable on-device model' });
  await act(async () => { resolveReply({ kind: 'answer', answer: draft, elapsedMs: 25 }); });
  expect(screen.queryByText(draft.text)).toBeNull();
  expect(screen.queryByText('Chrome LLM API is drafting a reply…')).toBeNull();
  expect(screen.getByText(firstFaq.answer)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Clear chat' }));
  native.enable.mockImplementationOnce((options: typeof nativeStartup) => {
    nativeStartup = options;
    return new Promise(resolve => { resolveNative = resolve; });
  });
  fireEvent.click(screen.getByRole('button', { name: 'Enable on-device model' }));
  await act(async () => { nativeStartup.onProgress(0.22); });
  expect(modelSummary.textContent).toMatch(/DOWNLOADING 22%/);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel loading' }));
  expect(nativeStartup.signal.aborted).toBe(true);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Enable on-device model' }).hasAttribute('disabled')).toBe(false));
  expect(modelSummary.textContent).toMatch(/OFF/);
  expect(screen.queryByRole('progressbar', { name: 'Chrome LLM API model download' })).toBeNull();
  // A session resolving after cancellation must be disposed, never shown as ready.
  const disposedBeforeCancel = native.dispose.mock.calls.length;
  await act(async () => { resolveNative({ reply: native.reply, dispose: native.dispose }); });
  expect(native.dispose).toHaveBeenCalledTimes(disposedBeforeCancel + 1);
  expect(modelSummary.textContent).toMatch(/OFF/);
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
  // Chrome may continue a shared download after this page cancels its request.
  native.enable.mockImplementationOnce((options: typeof nativeStartup) => {
    nativeStartup = options;
    return new Promise(resolve => { resolveNative = resolve; });
  });
  fireEvent.click(screen.getByRole('button', { name: 'Enable on-device model' }));
  await act(async () => { nativeStartup.onProgress(0.22); });
  native.availability.mockResolvedValueOnce('downloading');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel loading' }));
  expect(nativeStartup.signal.aborted).toBe(true);
  await screen.findByText('Chrome is downloading its model');
  const sharedDownload = screen.getByRole('progressbar', { name: 'Chrome LLM API model download' });
  expect(sharedDownload.getAttribute('value')).toBeNull();
  expect(modelSummary.textContent).toMatch(/DOWNLOADING/);
  expect(modelSummary.textContent).not.toMatch(/\d+%/);
  await act(async () => {
    nativeStartup.onProgress(0.9);
    resolveNative({ reply: native.reply, dispose: native.dispose });
  });
  expect(sharedDownload.getAttribute('value')).toBeNull();
  expect(modelSummary.textContent).not.toMatch(/\d+%/);
  expect(screen.queryByRole('button', { name: 'Turn off model' })).toBeNull();
  storageWrite.mockRestore();
});
