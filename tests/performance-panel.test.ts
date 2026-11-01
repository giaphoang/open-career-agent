import { describe, expect, it } from 'vitest';
import { percentile50, percentile95 } from '../src/PerformancePanel';

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
