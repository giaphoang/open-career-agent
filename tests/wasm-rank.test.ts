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

  it('compares independent FAQ aliases without treating synonyms as competitors', () => {
    // Two exact synonyms for FAQ 0 must not trigger a false tie against themselves.
    expect(rankRelatedEmbedding([1, 0], [1, 0, 1, 0, 0, 1], 2, [0, 0, 1])).toBe(0);
    expect(rankRelatedEmbedding([1, 0], [1, 0, 1, 0], 2, [0, 0])).toBe(0);
    // Equal or nearly-equal scores between DISTINCT FAQs remain unsafe.
    expect(rankRelatedEmbedding([1, 0], [1, 0, 1, 0], 2, [0, 1])).toBeNull();
    expect(rankRelatedEmbedding([1, 0], [1, 0, 0.99, 0.141], 2, [0, 1])).toBeNull();
  });

  it('rejects invalid alias mappings and oversized inputs', () => {
    expect(rankRelatedEmbedding([1, 0], [1, 0, 0, 1], 2, [0])).toBeNull();
    expect(rankRelatedEmbedding([1, 0], [1, 0], 2, [-1])).toBeNull();
    expect(rankRelatedEmbedding([1, 0], [1, 0], 2, [40])).toBeNull();
    expect(rankRelatedEmbedding([1, 0], [1, 0, 0, 1], 2, [1, 0])).toBeNull();
    expect(rankRelatedEmbedding([1], new Float32Array(201).fill(1), 1, Array(201).fill(0))).toBeNull();
  });

  it('reports raw top-two FAQ scores without changing the conservative gate', () => {
    const scores: { bestIndex: number; bestCosine: number; runnerUpCosine: number | null }[] = [];
    expect(rankRelatedEmbedding([1, 0], [1, 0, 0.99, 0.141], 2, [0, 1], value => scores.push(value))).toBeNull();
    expect(scores).toHaveLength(1);
    expect(scores[0]?.bestIndex).toBe(0);
    expect(scores[0]?.bestCosine).toBeCloseTo(1);
    expect(scores[0]?.runnerUpCosine).toBeCloseTo(0.99, 2);
    // A broken optional observer cannot affect user-visible evidence selection.
    expect(rankRelatedEmbedding([1, 0], [1, 0], 2, undefined, () => { throw Error('observer'); })).toBe(0);
    expect(rankRelatedEmbedding([0, 0], [1, 0], 2, undefined, value => scores.push(value))).toBeNull();
    expect(scores).toHaveLength(1);
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
