import { describe, it, expect } from 'vitest'
import { latencyStats, type LatencySample } from './latency'

function sample(over: Partial<LatencySample> = {}): LatencySample {
  return {
    id: 'u1',
    sttMs: 800,
    transportMs: 120,
    translationMs: 600,
    renderMs: 16,
    ...over,
  }
}

describe('latencyStats', () => {
  it('returns a zeroed, empty result for no samples', () => {
    const stats = latencyStats([])
    expect(stats.count).toBe(0)
    expect(stats.skewSuspected).toBe(false)
    expect(stats.segments.total).toEqual({ min: 0, median: 0, p95: 0, max: 0 })
    expect(stats.segments.stt).toEqual({ min: 0, median: 0, p95: 0, max: 0 })
  })

  it('reports one sample as every statistic for that sample', () => {
    const stats = latencyStats([sample()])
    expect(stats.count).toBe(1)
    expect(stats.segments.stt).toEqual({ min: 800, median: 800, p95: 800, max: 800 })
    // total = stt + transport + translation + render = 800 + 120 + 600 + 16
    expect(stats.segments.total).toEqual({ min: 1536, median: 1536, p95: 1536, max: 1536 })
  })

  it('computes the median as the average of the two middle values for an even count', () => {
    const stats = latencyStats([
      sample({ sttMs: 100 }),
      sample({ sttMs: 200 }),
      sample({ sttMs: 300 }),
      sample({ sttMs: 400 }),
    ])
    expect(stats.segments.stt.median).toBe(250)
  })

  it('computes the median as the middle value for an odd count', () => {
    const stats = latencyStats([
      sample({ sttMs: 100 }),
      sample({ sttMs: 500 }),
      sample({ sttMs: 300 }),
    ])
    expect(stats.segments.stt.median).toBe(300)
  })

  it('computes p95 over a larger sample set', () => {
    // 20 samples, sttMs = 10, 20, ..., 200. Sorted, index for p95 (ceil(0.95*20)-1 = 18) -> value 190.
    const values = Array.from({ length: 20 }, (_, i) => (i + 1) * 10)
    const stats = latencyStats(values.map((sttMs) => sample({ sttMs })))
    expect(stats.segments.stt.p95).toBe(190)
    expect(stats.segments.stt.max).toBe(200)
    expect(stats.segments.stt.min).toBe(10)
  })

  it('flags skewSuspected on a negative transport sample without clamping it', () => {
    const stats = latencyStats([sample({ transportMs: -50 }), sample({ transportMs: 100 })])
    expect(stats.skewSuspected).toBe(true)
    expect(stats.segments.transport.min).toBe(-50)
  })

  it('does not suspect skew when all transport samples are non-negative', () => {
    const stats = latencyStats([sample({ transportMs: 0 }), sample({ transportMs: 100 })])
    expect(stats.skewSuspected).toBe(false)
  })
})
