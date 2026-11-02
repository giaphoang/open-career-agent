/**
 * Select a *related* FAQ from local embeddings. This does not verify career facts.
 * A nearest neighbour always exists, even for unrelated questions. Reject weak
 * and ambiguous results instead of presenting a random FAQ to a recruiter.
 *
 * The two guards are conservative heuristics, NOT calibrated confidence scores.
 * Optional groupIds map each independently embedded FAQ alias to its parent FAQ;
 * the winning margin compares distinct FAQs, not synonyms of the same FAQ.
 */
export interface WasmRankingDiagnostics { bestIndex: number; bestCosine: number; runnerUpCosine: number | null }

export const MIN_RELATED_COSINE = 0.48;
export const MIN_WINNING_MARGIN = 0.04;

export function rankRelatedEmbedding(
  query: ArrayLike<number>,
  candidates: ArrayLike<number>,
  dimensions: number,
  groupIds?: readonly number[],
  onRanking?: (diagnostics: WasmRankingDiagnostics) => void,
): number | null {
  if (!Number.isSafeInteger(dimensions) || dimensions <= 0 || query.length !== dimensions ||
    candidates.length === 0 || candidates.length % dimensions !== 0 ||
    candidates.length / dimensions > (groupIds ? 200 : 40)) return null;
  const rows = candidates.length / dimensions;
  if (groupIds && (groupIds.length !== rows || groupIds.some((id, i) =>
    !Number.isSafeInteger(id) || id < 0 || id >= 40 || (i > 0 && id < groupIds[i - 1]!)))) return null;

  let queryNormSquared = 0;
  for (let col = 0; col < dimensions; col++) {
    const value = Number(query[col]);
    if (!Number.isFinite(value)) return null;
    queryNormSquared += value * value;
  }
  if (!Number.isFinite(queryNormSquared) || queryNormSquared <= 0) return null;

  const bestByFaq = new Float64Array(40).fill(-Infinity);
  for (let row = 0; row < rows; row++) {
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
    const faqIndex = groupIds ? groupIds[row]! : row;
    if (cosine > bestByFaq[faqIndex]!) bestByFaq[faqIndex] = cosine;
  }
  let bestIndex = -1;
  let best = -Infinity;
  let secondBest = -Infinity;
  for (let faqIndex = 0; faqIndex < bestByFaq.length; faqIndex++) {
    const cosine = bestByFaq[faqIndex]!;
    if (cosine > best) {
      secondBest = best;
      best = cosine;
      bestIndex = faqIndex;
    } else if (cosine > secondBest) secondBest = cosine;
  }
  // Expose non-identifying ranking scores to opt-in local benchmark instrumentation.
  // This callback must never change selection or make a failed model look healthy.
  try { onRanking?.({ bestIndex, bestCosine: best, runnerUpCosine: secondBest === -Infinity ? null : secondBest }); }
  catch { /* metrics are non-critical */ }
  if (best < MIN_RELATED_COSINE || (secondBest !== -Infinity && best - secondBest < MIN_WINNING_MARGIN)) return null;
  return bestIndex;
}
