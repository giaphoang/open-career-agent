/**
 * Select a *related* FAQ from local embeddings. This does not verify career facts.
 * A nearest neighbour always exists, even for unrelated questions. Reject weak
 * and ambiguous results instead of presenting a random FAQ to a recruiter.
 *
 * The two guards are conservative starting heuristics, NOT calibrated confidence
 * scores. Validate them against real labeled queries before changing them.
 */
export const MIN_RELATED_COSINE = 0.48;
export const MIN_WINNING_MARGIN = 0.04;

export function rankRelatedEmbedding(
  query: ArrayLike<number>,
  candidates: ArrayLike<number>,
  dimensions: number,
): number | null {
  if (!Number.isSafeInteger(dimensions) || dimensions <= 0 || query.length !== dimensions ||
    candidates.length === 0 || candidates.length % dimensions !== 0 ||
    candidates.length / dimensions > 40) return null;

  let queryNormSquared = 0;
  for (let col = 0; col < dimensions; col++) {
    const value = Number(query[col]);
    if (!Number.isFinite(value)) return null;
    queryNormSquared += value * value;
  }
  if (!Number.isFinite(queryNormSquared) || queryNormSquared <= 0) return null;

  let bestIndex = -1;
  let best = -Infinity;
  let secondBest = -Infinity;
  for (let row = 0; row < candidates.length / dimensions; row++) {
    let dot = 0;
    let rowNormSquared = 0;
    for (let col = 0; col < dimensions; col++) {
      const value = Number(candidates[row * dimensions + col]);
      if (!Number.isFinite(value)) return null;
      dot += Number(query[col]) * value;
      rowNormSquared += value * value;
    }
    if (!Number.isFinite(rowNormSquared) || rowNormSquared <= 0) return null;
    const cosine = dot / Math.sqrt(queryNormSquared * rowNormSquared);
    if (!Number.isFinite(cosine)) return null;
    if (cosine > best) {
      secondBest = best;
      best = cosine;
      bestIndex = row;
    } else if (cosine > secondBest) {
      secondBest = cosine;
    }
  }
  if (best < MIN_RELATED_COSINE || (secondBest !== -Infinity && best - secondBest < MIN_WINNING_MARGIN)) return null;
  return bestIndex;
}
