import { afterEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ calls: [] as string[][] }));
vi.mock('@huggingface/transformers', () => ({
  env: { useBrowserCache: true, useWasmCache: true, allowLocalModels: true, backends: { onnx: { wasm: { numThreads: 4 } } } },
  pipeline: vi.fn(async () => async (items: string[]) => {
    mock.calls.push([...items]);
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

    const candidates = ['Java backend skills', 'React frontend skills'];
    emit({ type: 'search', id: 1, question: 'Java expertise?', candidates });
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'result', id: 1, index: 0, faqCacheHit: false }));
    expect(mock.calls).toEqual([candidates, ['Java expertise?']]);

    emit({ type: 'search', id: 2, question: 'React expertise?', candidates });
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'result', id: 2, index: 1, faqCacheHit: true }));
    expect(mock.calls).toEqual([candidates, ['Java expertise?'], ['React expertise?']]);

    const updated = ['Java API experience', 'React frontend skills'];
    emit({ type: 'search', id: 3, question: 'Java API?', candidates: updated });
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'result', id: 3, index: 0, faqCacheHit: false }));
    expect(mock.calls).toEqual([candidates, ['Java expertise?'], ['React expertise?'], updated, ['Java API?']]);
  });
});
