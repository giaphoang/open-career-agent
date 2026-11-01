// @vitest-environment jsdom
import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PerformancePanel, percentile50, percentile95 } from '../src/PerformancePanel';

describe('session percentiles', () => {
  it('reports no measurement for no calls and uses nearest-rank on small samples', () => {
    expect(percentile50([])).toBeNull();
    expect(percentile95([])).toBeNull();
    expect(percentile50([1])).toBe(1);
    expect(percentile95([1])).toBe(1);
    const reversed = Array.from({ length: 20 }, (_, i) => 20 - i);
    expect(percentile50(reversed)).toBe(10);
    expect(percentile95(reversed)).toBe(19);
  });
});


describe('separate FAQ cache measurements', () => {
  it('does not mix first embedding pass with cache-hit p50/p95', () => {
    render(createElement(PerformancePanel, {
      decisionTimes: [0.2],
      wasmStartupMs: 1000,
      wasmSearchTimes: [200, 10, 20],
      wasmFaqCacheMissMs: 200,
      wasmFaqCacheHitTimes: [10, 20],
    }));
    expect(screen.getByText('FAQ cache-miss query (latest)').parentElement?.textContent).toContain('200.0 ms');
    expect(screen.getByText('Cached FAQ query samples').parentElement?.textContent).toContain('2');
    expect(screen.getByText('Cached FAQ query p50 / p95').parentElement?.textContent).toContain('10.0 / 20.0 ms');
    expect(screen.getByText('WASM search p50 / p95').parentElement?.textContent).toContain('20.0 / 200.0 ms');
  });
});
