import { useEffect, useState } from 'react';

/** Nearest-rank percentiles; one visitor's session is not a population benchmark. */
function percentile(samples: readonly number[], fraction: number): number | null {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * fraction) - 1] ?? null;
}
export function percentile50(samples: readonly number[]): number | null { return percentile(samples, 0.5); }
export function percentile95(samples: readonly number[]): number | null { return percentile(samples, 0.95); }

interface Props {
  decisionTimes: readonly number[];
  wasmStartupMs?: number | null;
  wasmSearchTimes?: readonly number[];
  wasmFaqCacheMissMs?: number | null;
  wasmFaqCacheHitTimes?: readonly number[];
}

export function PerformancePanel({ decisionTimes, wasmStartupMs = null, wasmSearchTimes = [], wasmFaqCacheMissMs = null, wasmFaqCacheHitTimes = [] }: Props) {
  const [lcp, setLcp] = useState<number | null>(null);
  useEffect(() => {
    if (typeof PerformanceObserver === 'undefined') return;
    try {
      const observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) if (entry.entryType === 'largest-contentful-paint') setLcp(entry.startTime);
      });
      observer.observe({ type: 'largest-contentful-paint', buffered: true });
      return () => observer.disconnect();
    } catch { return; }
  }, []);
  const rulesP95 = percentile95(decisionTimes);
  const wasmP50 = percentile50(wasmSearchTimes);
  const wasmP95 = percentile95(wasmSearchTimes);
  const cachedP50 = percentile50(wasmFaqCacheHitTimes);
  const cachedP95 = percentile95(wasmFaqCacheHitTimes);
  return <details className="performance-panel">
    <summary>Performance in this session <span>ON THIS DEVICE &nbsp; +</span></summary>
    <div className="performance-content">
      <p>Measurements stay in this tab and are not sent or saved. These are observations from one session, not a benchmark or proof of the PRD targets.</p>
      <dl>
        <div><dt>Rules engine samples (last 200)</dt><dd>{decisionTimes.length}</dd></div>
        <div><dt>Engine-only p95</dt><dd>{rulesP95 === null ? 'Ask a question first' : `${rulesP95.toFixed(2)} ms`}</dd></div>
        <div><dt>WASM model startup (worker + model)</dt><dd>{wasmStartupMs === null ? 'Enable WASM search first' : `${Math.round(wasmStartupMs)} ms`}</dd></div>
        <div><dt>WASM search samples (last 200)</dt><dd>{wasmSearchTimes.length}</dd></div>
        <div><dt>WASM search p50 / p95</dt><dd>{wasmP50 === null || wasmP95 === null ? 'Ask an unanswered question with WASM enabled' : `${wasmP50.toFixed(1)} / ${wasmP95.toFixed(1)} ms`}</dd></div>
        <div><dt>FAQ cache-miss query (latest)</dt><dd>{wasmFaqCacheMissMs === null ? 'Not measured yet' : `${wasmFaqCacheMissMs.toFixed(1)} ms`}</dd></div>
        <div><dt>Cached FAQ query samples</dt><dd>{wasmFaqCacheHitTimes.length}</dd></div>
        <div><dt>Cached FAQ query p50 / p95</dt><dd>{cachedP50 === null || cachedP95 === null ? 'Ask another unanswered question' : `${cachedP50.toFixed(1)} / ${cachedP95.toFixed(1)} ms`}</dd></div>
        <div><dt>Observed LCP candidate</dt><dd>{lcp === null ? 'Not available' : `${Math.round(lcp)} ms`}</dd></div>
      </dl>
      <p>Engine-only timing excludes rendering and inference. WASM timing measures worker startup until ready and wall-clock search request to worker result, including messaging and inference; completed successful inferences may include no match; inference errors and malformed worker responses are excluded from timings. UI rendering, cancellations, and timeouts are excluded. FAQ cache-miss time includes embedding the authored questions and the recruiter question; a cache-hit query reuses the FAQ vectors but still embeds the new question. These are worker-reported cache states, not proof of a speedup; only genuine model-completed no-match replies are timed; worker errors are not. Browser/network caches affect startup. LCP is the latest browser-reported candidate, not a p75 across visits. Browser support varies.</p>
    </div>
  </details>;
}
