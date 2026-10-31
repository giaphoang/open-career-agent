import { useEffect, useState } from 'react';

/** Nearest-rank p95; a small session is descriptive, not a population benchmark. */
export function percentile95(samples: readonly number[]): number | null {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? null;
}
export function PerformancePanel({ decisionTimes }: { decisionTimes: readonly number[] }) {
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
  const p95 = percentile95(decisionTimes);
  return <details className="performance-panel"><summary>Performance in this session <span>ON THIS DEVICE &nbsp; +</span></summary><div className="performance-content"><p>Measurements stay in this tab and are not sent or saved. These are observations from one session, not a benchmark or proof of the PRD targets.</p><dl><div><dt>Rules engine samples (last 200)</dt><dd>{decisionTimes.length}</dd></div><div><dt>Engine-only p95</dt><dd>{p95 === null ? 'Ask a question first' : `${p95.toFixed(2)} ms`}</dd></div><div><dt>Observed LCP candidate</dt><dd>{lcp === null ? 'Not available' : `${Math.round(lcp)} ms`}</dd></div></dl><p>Engine timing excludes rendering, network and model inference. LCP is the latest browser-reported candidate, not a p75 across visits. Browser support varies.</p></div></details>;
}
