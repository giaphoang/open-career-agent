/** Run untrusted queries only as local embedding inputs, never as model instructions. */
import { env, pipeline } from '@huggingface/transformers';

// This module only runs as a dedicated Worker; TypeScript's DOM configuration
// does not include the separate WebWorker global type.
const scope = globalThis as unknown as {
  addEventListener(type: 'message', handler: (event: MessageEvent<unknown>) => void): void;
  postMessage(message: unknown): void;
};

env.useBrowserCache = false;
env.useWasmCache = false;
env.allowLocalModels = false;
if (env.backends.onnx.wasm) env.backends.onnx.wasm.numThreads = 1;

let extractor: Awaited<ReturnType<typeof makeExtractor>> | undefined;
let working = false;
const makeExtractor = () => pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
  revision: '751bff37182d3f1213fa05d7196b954e230abad9',
  device: 'wasm',
  dtype: 'q8',
  progress_callback(progress) {
    if (progress.status === 'progress' && typeof progress.progress === 'number' && Number.isFinite(progress.progress)) {
      scope.postMessage({ type: 'progress', progress: Math.max(0, Math.min(1, progress.progress / 100)) });
    }
  },
});

scope.addEventListener('message', event => {
  const value = event.data;
  if (typeof value !== 'object' || value === null || !('type' in value)) return;
  if (value.type === 'init' && !extractor && !working) {
    working = true;
    void makeExtractor().then(result => { extractor = result; scope.postMessage({ type: 'ready' }); })
      .catch(() => scope.postMessage({ type: 'error' })).finally(() => { working = false; });
    return;
  }
  if (value.type !== 'search' || !extractor || working || !('question' in value) || !('candidates' in value) || !('id' in value)) return;
  const { question, candidates, id } = value;
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || typeof question !== 'string' || question.length > 2000 || !Array.isArray(candidates) || candidates.length === 0 || candidates.length > 40 || !candidates.every((candidate: unknown) => typeof candidate === 'string' && candidate.length <= 1200)) {
    scope.postMessage({ type: 'result', id, index: null });
    return;
  }
  working = true;
  const currentExtractor = extractor;
  void (async () => {
    const embeddings = await currentExtractor([question, ...candidates], { pooling: 'mean', normalize: true });
    const dimensions = embeddings.dims[1];
    if (!dimensions || embeddings.dims[0] !== candidates.length + 1 || embeddings.data.length !== (candidates.length + 1) * dimensions) return null;
    let best: number | null = null;
    let bestScore = -Infinity;
    for (let index = 0; index < candidates.length; index++) {
      let score = 0;
      for (let column = 0; column < dimensions; column++) {
        const a = Number(embeddings.data[column]);
        const b = Number(embeddings.data[(index + 1) * dimensions + column]);
        if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
        score += a * b;
      }
      if (score > bestScore) { bestScore = score; best = index; }
    }
    return best;
  })().then(index => scope.postMessage({ type: 'result', id, index }))
    .catch(() => scope.postMessage({ type: 'result', id, index: null })).finally(() => { working = false; });
});
