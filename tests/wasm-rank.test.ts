import { describe, expect, it } from 'vitest';
import { rankRelatedEmbedding } from '../src/wasm-rank';

describe('conservative WASM embedding retrieval', () => {
  it('returns a clear related match and is independent of embedding magnitude', () => {
    expect(rankRelatedEmbedding([2, 0], [0, 1, 3, 0], 2)).toBe(1);
    expect(rankRelatedEmbedding([1, 0], [1, 0], 2)).toBe(0);
  });

  it('rejects an unrelated nearest neighbor instead of making a forced suggestion', () => {
    expect(rankRelatedEmbedding([1, 0], [0, 1, 0, -1], 2)).toBeNull();
    expect(rankRelatedEmbedding([1, 0], [-1, 0], 2)).toBeNull();
  });

  it('abstains from tied or nearly tied candidates', () => {
    expect(rankRelatedEmbedding([1, 0], [1, 0, 1, 0], 2)).toBeNull();
    expect(rankRelatedEmbedding([1, 0], [1, 0, 0.999, 0.0447], 2)).toBeNull();
  });

  it('rejects malformed tensor shapes and non-finite or zero embeddings', () => {
    expect(rankRelatedEmbedding([1], [], 1)).toBeNull();
    expect(rankRelatedEmbedding([1, 0], [1], 2)).toBeNull();
    expect(rankRelatedEmbedding([1, 0], [1, 0], 0)).toBeNull();
    expect(rankRelatedEmbedding([0, 0], [1, 0], 2)).toBeNull();
    expect(rankRelatedEmbedding([1, 0], [0, 0], 2)).toBeNull();
    expect(rankRelatedEmbedding([1, 0], [NaN, 0], 2)).toBeNull();
    expect(rankRelatedEmbedding([1, Infinity], [1, 0], 2)).toBeNull();
    expect(rankRelatedEmbedding([1], Array.from({ length: 41 }, () => 1), 1)).toBeNull();
  });
});
