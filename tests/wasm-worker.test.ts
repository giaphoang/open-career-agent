import { afterEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ calls: [] as string[][] }));
vi.mock('@huggingface/transformers', () => ({
  env: { useBrowserCache: true, useWasmCache: true, allowLocalModels: true, backends: { onnx: { wasm: { numThreads: 4 } } } },
  pipeline: vi.fn(async () => async (items: string[]) => {
    mock.calls.push([...items]);
    if (items.includes('SIMULATE_FAILURE')) throw new Error('simulated embedding failure');
    if (items.includes('MALFORMED_TENSOR')) return { dims: [1, 99], data: new Float32Array([1, 0]) };
    const data = items.flatMap(text => /java/i.test(text) ? [1, 0] : /react/i.test(text) ? [0, 1] : [-1, 0]);
    return { dims: [items.length, 2], data: Float32Array.from(data) };
  }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  mock.calls.length = 0;
});

describe('WASM worker inference reuse', () => {
  it('embeds FAQs once, then only queries; invalidates on a new FAQ set', async () => {
    let receive: ((event: MessageEvent<unknown>) => void) | undefined;
    const send = vi.fn();
    vi.stubGlobal('postMessage', send);
    vi.stubGlobal('addEventListener', (type: string, handler: (event: MessageEvent<unknown>) => void) => {
      if (type === 'message') receive = handler;
    });
    await import('../src/wasm-worker');
    const emit = (data: unknown) => receive?.({ data } as MessageEvent<unknown>);
    emit({ type: 'init' });
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'ready' }));

    const candidates = [['Java backend skills', 'Java design experience'], ['React frontend skills']];
    emit({ type: 'search', id: 1, question: 'Java expertise?', candidates });
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'result', id: 1, index: 0, faqCacheHit: false, ok: true, ranking: expect.objectContaining({ bestIndex: 0, bestCosine: 1 }) })));
    expect(mock.calls).toEqual([candidates.flat(), ['Java expertise?']]);

    emit({ type: 'search', id: 2, question: 'React expertise?', candidates });
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'result', id: 2, index: 1, faqCacheHit: true, ok: true, ranking: expect.objectContaining({ bestIndex: 1 }) })));
    expect(mock.calls).toEqual([candidates.flat(), ['Java expertise?'], ['React expertise?']]);

    const updated = [['Java API experience'], ['React frontend skills']];
    emit({ type: 'search', id: 3, question: 'Java API?', candidates: updated });
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'result', id: 3, index: 0, faqCacheHit: false, ok: true })));
    expect(mock.calls).toEqual([candidates.flat(), ['Java expertise?'], ['React expertise?'], updated.flat(), ['Java API?']]);

    emit({ type: 'search', id: 31, question: 'React?', candidates: ['Not grouped'] });
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'result', id: 31, index: null, ok: false }));
    expect(mock.calls).toHaveLength(5); // rejected before embedding

    // Model exceptions must be distinguishable from a legitimate low-similarity
    // abstention, while preserving the existing cached FAQ vectors.
    emit({ type: 'search', id: 4, question: 'SIMULATE_FAILURE', candidates: updated });
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'result', id: 4, index: null, faqCacheHit: true, ok: false }));
    emit({ type: 'search', id: 5, question: 'React follow-up?', candidates: updated });
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'result', id: 5, index: 1, faqCacheHit: true, ok: true })));
    emit({ type: 'search', id: 6, question: 'MALFORMED_TENSOR', candidates: updated });
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'result', id: 6, index: null, faqCacheHit: true, ok: false }));
  });
});
