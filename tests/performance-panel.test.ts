import { describe, expect, it } from 'vitest';
import { percentile95 } from '../src/PerformancePanel';

describe('session percentile', () => {
  it('reports no measurement for no calls and nearest-rank p95 for a session', () => {
    expect(percentile95([])).toBeNull();
    expect(percentile95([1])).toBe(1);
    expect(percentile95(Array.from({ length: 20 }, (_, i) => 20 - i))).toBe(19);
  });
});
