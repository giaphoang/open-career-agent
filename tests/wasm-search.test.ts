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
  it('measures startup and successful query wall-clock latency without recording aborted work', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const onTiming = vi.fn();
    const created = createWasmSearch({ signal: new AbortController().signal, onTiming });
    const worker = FakeWorker.last;
    worker.emit({ type: 'ready' });
    const search = await created;
    expect(onTiming).toHaveBeenCalledTimes(1);
    expect(onTiming).toHaveBeenCalledWith({ phase: 'startup', elapsedMs: expect.any(Number) });
    const pending = search.select('Java work?', faqs, new AbortController().signal);
    worker.emit({ type: 'result', ok: true, id: 1, index: 0, faqCacheHit: false });
    expect(await pending).toBe(0);
    expect(onTiming).toHaveBeenCalledTimes(2);
    expect(onTiming).toHaveBeenLastCalledWith({ phase: 'query', elapsedMs: expect.any(Number), faqCacheHit: false });
    const duration = onTiming.mock.calls[1]![0] as { phase: string; elapsedMs: number };
    expect(duration.phase).toBe('query');
    expect(duration.elapsedMs).toBeGreaterThanOrEqual(0);
    const controller = new AbortController();
    const aborted = search.select('React work?', faqs, controller.signal);
    controller.abort();
    expect(await aborted).toBeNull();
    expect(onTiming).toHaveBeenCalledTimes(2);
  });
  it('separates cached-FAQ query time from startup without assuming the selection is true', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const onTiming = vi.fn();
    const created = createWasmSearch({ signal: new AbortController().signal, onTiming });
    const worker = FakeWorker.last;
    worker.emit({ type: 'ready' });
    const search = await created;
    const pending = search.select('Unverified question', faqs, new AbortController().signal);
    worker.emit({ type: 'result', ok: true, id: 1, index: null, faqCacheHit: true });
    expect(await pending).toBeNull();
    expect(onTiming).toHaveBeenLastCalledWith({ phase: 'query', elapsedMs: expect.any(Number), faqCacheHit: true });
    search.dispose();
  });

  it('does not break search if a timing observer throws', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const created = createWasmSearch({
      signal: new AbortController().signal,
      onTiming: () => { throw new Error('broken local observer'); },
    });
    FakeWorker.last.emit({ type: 'ready' });
    const search = await created;
    const pending = search.select('Java work?', faqs, new AbortController().signal);
    FakeWorker.last.emit({ type: 'result', ok: true, id: 1, index: 0 });
    expect(await pending).toBe(0);
    search.dispose();
  });
  it('keeps WASM initialization and teardown alive when optional UI observers throw', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const onProgress = vi.fn(() => { throw new Error('broken progress observer'); });
    const onClosed = vi.fn(() => { throw new Error('broken close observer'); });
    const created = createWasmSearch({ signal: new AbortController().signal, onProgress, onClosed });
    const worker = FakeWorker.last;
    expect(() => worker.emit({ type: 'progress', progress: 0.45 })).not.toThrow();
    expect(onProgress).toHaveBeenCalledWith(0.45);
    worker.emit({ type: 'ready' });
    const search = await created;
    const pending = search.select('Java work?', faqs, new AbortController().signal);
    worker.emit({ type: 'result', ok: true, id: 1, index: 0 });
    expect(await pending).toBe(0);
    expect(() => search.dispose()).not.toThrow();
    expect(onClosed).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('starts only when requested and validates a successful worker response', async () => {
    const { worker, search, onClosed } = await ready();
    const pending = search.select('Have you built React UIs?', faqs, new AbortController().signal);
    expect(worker.postMessage).toHaveBeenLastCalledWith({ type: 'search', id: 1, question: 'Have you built React UIs?', candidates: faqs.map(entry => [...entry.questions]) });
    worker.emit({ type: 'result', ok: true, id: 1, index: 1 });
    expect(await pending).toBe(1);
    search.dispose();
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(onClosed).toHaveBeenCalledOnce();
  });

  it('refuses out-of-range, forged, and malformed worker selections', async () => {
    const { worker, search } = await ready();
    const pending = search.select('Something new', faqs, new AbortController().signal);
    worker.emit({ type: 'result', ok: true, id: 999, index: 0 });
    worker.emit({ type: 'result', ok: true, id: 1, index: 999 });
    expect(await pending).toBeNull();
    const second = search.select('Another question', faqs, new AbortController().signal);
    worker.emit({ type: 'result', ok: true, id: 2, index: '0' });
    expect(await second).toBeNull();
    search.dispose();
  });

  it('cancels stale results without unloading WASM; resumes search after worker finishes', async () => {
    const onTiming = vi.fn();
    vi.stubGlobal('Worker', FakeWorker);
    const created = createWasmSearch({ signal: new AbortController().signal, onTiming });
    const worker = FakeWorker.last;
    worker.emit({ type: 'ready' });
    const search = await created;
    const controller = new AbortController();
    const pending = search.select('Java?', faqs, controller.signal);
    controller.abort();
    expect(await pending).toBeNull();
    // Cancelled inference is still occupying the worker. Do not enqueue a
    // search that the busy worker would silently ignore.
    expect(await search.select('React?', faqs, new AbortController().signal)).toBeNull();
    expect(worker.postMessage).toHaveBeenCalledTimes(2); // init + original search
    expect(worker.terminate).not.toHaveBeenCalled();
    worker.emit({ type: 'result', ok: true, id: 1, index: 0 });
    expect(onTiming).toHaveBeenCalledTimes(1); // startup only; stale result is not timed
    const next = search.select('React?', faqs, new AbortController().signal);
    expect(worker.postMessage).toHaveBeenCalledTimes(3);
    worker.emit({ type: 'result', ok: true, id: 2, index: 1 });
    expect(await next).toBe(1);
    expect(onTiming).toHaveBeenCalledTimes(2);
    search.dispose();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('abstains without recording latency for inference errors or results missing success metadata', async () => {
    const onTiming = vi.fn();
    vi.stubGlobal('Worker', FakeWorker);
    const created = createWasmSearch({ signal: new AbortController().signal, onTiming });
    const worker = FakeWorker.last;
    worker.emit({ type: 'ready' });
    const search = await created;
    const failed = search.select('Failed inference', faqs, new AbortController().signal);
    worker.emit({ type: 'result', id: 1, index: 0, ok: false, faqCacheHit: true });
    expect(await failed).toBeNull();
    expect(onTiming).toHaveBeenCalledTimes(1); // startup only

    const unmarked = search.select('Unmarked response', faqs, new AbortController().signal);
    worker.emit({ type: 'result', id: 2, index: 0 });
    expect(await unmarked).toBeNull();
    expect(onTiming).toHaveBeenCalledTimes(1);

    const abstained = search.select('Valid abstention', faqs, new AbortController().signal);
    worker.emit({ type: 'result', id: 3, index: null, ok: true, faqCacheHit: true });
    expect(await abstained).toBeNull();
    expect(onTiming).toHaveBeenCalledTimes(2); // legitimate no-match inference is measured

    const recovered = search.select('Recovered inference', faqs, new AbortController().signal);
    worker.emit({ type: 'result', id: 4, index: 1, ok: true, faqCacheHit: true });
    expect(await recovered).toBe(1);
    expect(onTiming).toHaveBeenCalledTimes(3);
    search.dispose();
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
