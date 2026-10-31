import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWasmSearch } from '../src/wasm-search';

class FakeWorker {
  static last: FakeWorker;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { FakeWorker.last = this; }
  emit(data: unknown) { this.onmessage?.({ data } as MessageEvent<unknown>); }
}
const faqs = [{ questions: ['What Java work have you done?'] }, { questions: ['What React work have you done?'] }];

afterEach(() => vi.unstubAllGlobals());

async function ready(onClosed = vi.fn()) {
  vi.stubGlobal('Worker', FakeWorker);
  const created = createWasmSearch({ signal: new AbortController().signal, onClosed });
  const worker = FakeWorker.last;
  expect(worker.postMessage).toHaveBeenCalledWith({ type: 'init' });
  worker.emit({ type: 'ready' });
  return { worker, search: await created, onClosed };
}

describe('WASM worker boundary', () => {
  it('starts only when requested and validates a successful worker response', async () => {
    const { worker, search, onClosed } = await ready();
    const pending = search.select('Have you built React UIs?', faqs, new AbortController().signal);
    expect(worker.postMessage).toHaveBeenLastCalledWith({ type: 'search', id: 1, question: 'Have you built React UIs?', candidates: faqs.map(entry => entry.questions[0]) });
    worker.emit({ type: 'result', id: 1, index: 1 });
    expect(await pending).toBe(1);
    search.dispose();
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(onClosed).toHaveBeenCalledOnce();
  });

  it('refuses out-of-range, forged, and malformed worker selections', async () => {
    const { worker, search } = await ready();
    const pending = search.select('Something new', faqs, new AbortController().signal);
    worker.emit({ type: 'result', id: 999, index: 0 });
    worker.emit({ type: 'result', id: 1, index: 999 });
    expect(await pending).toBeNull();
    const second = search.select('Another question', faqs, new AbortController().signal);
    worker.emit({ type: 'result', id: 2, index: '0' });
    expect(await second).toBeNull();
    search.dispose();
  });

  it('terminates and resolves without an answer when a search is canceled', async () => {
    const { worker, search, onClosed } = await ready();
    const controller = new AbortController();
    const pending = search.select('Java?', faqs, controller.signal);
    controller.abort();
    expect(await pending).toBeNull();
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(onClosed).toHaveBeenCalledOnce();
    expect(await search.select('React?', faqs, new AbortController().signal)).toBeNull();
  });

  it('stops an explicitly started download when canceled and reports failures', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const controller = new AbortController();
    const created = createWasmSearch({ signal: controller.signal });
    const worker = FakeWorker.last;
    controller.abort();
    await expect(created).rejects.toThrow('Canceled');
    expect(worker.terminate).toHaveBeenCalledOnce();
    const failed = createWasmSearch({ signal: new AbortController().signal });
    FakeWorker.last.emit({ type: 'error' });
    await expect(failed).rejects.toThrow('Could not load');
  });
});
