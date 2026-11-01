/** Run untrusted queries only as local embedding inputs, never as model instructions. */
import { env, pipeline } from '@huggingface/transformers';
import { rankRelatedEmbedding } from './wasm-rank';

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
// Only the latest FAQ set is cached; replacing the profile replaces this cache.
// One set of up to 40 normalized embeddings is small (about 60 KiB at 384 dims).
let cachedKey: string | null = null;
let cachedVectors: Float32Array | null = null;
let cachedDimensions = 0;

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
  let faqCacheHit = false;
  void (async () => {
    const key = JSON.stringify(candidates);
    let vectors = cachedVectors;
    let dimensions = cachedDimensions;
    faqCacheHit = !!vectors && key === cachedKey;
    if (!faqCacheHit) {
      // Previous version embedded every FAQ on every question. This work is
      // invariant for a static CV, so compute it only once per candidate set.
      const faqEmbeddings = await currentExtractor(candidates, { pooling: 'mean', normalize: true });
      dimensions = faqEmbeddings.dims[1] ?? 0;
      if (faqEmbeddings.dims.length !== 2 || !dimensions || faqEmbeddings.dims[0] !== candidates.length ||
        faqEmbeddings.data.length !== candidates.length * dimensions) return null;
      const copy = new Float32Array(faqEmbeddings.data.length);
      for (let i = 0; i < copy.length; i++) {
        const number = Number(faqEmbeddings.data[i]);
        if (!Number.isFinite(number)) return null;
        copy[i] = number;
      }
      vectors = copy;
      cachedVectors = copy;
      cachedDimensions = dimensions;
      cachedKey = key;
    }
    // Only one short recruiter question requires inference on repeat turns.
    const questionEmbedding = await currentExtractor([question], { pooling: 'mean', normalize: true });
    if (questionEmbedding.dims.length !== 2 || questionEmbedding.dims[0] !== 1 ||
      questionEmbedding.dims[1] !== dimensions || questionEmbedding.data.length !== dimensions) return null;
    const query = new Float32Array(dimensions);
    for (let i = 0; i < dimensions; i++) {
      const number = Number(questionEmbedding.data[i]);
      if (!Number.isFinite(number)) return null;
      query[i] = number;
    }
    return rankRelatedEmbedding(query, vectors, dimensions);
  })().then(index => scope.postMessage({ type: 'result', id, index, faqCacheHit }))
    .catch(() => scope.postMessage({ type: 'result', id, index: null, faqCacheHit })).finally(() => { working = false; });
});
