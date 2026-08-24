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

  it('reports renderUnmeasured as 0 when every sample has a renderMs', () => {
    const stats = latencyStats([sample(), sample()])
    expect(stats.renderUnmeasured).toBe(0)
  })

  it('excludes a sample with no renderMs from render stats but still counts it and its other segments', () => {
    const measured = sample({ sttMs: 800, renderMs: 16 })
    const unmeasured = sample({ sttMs: 1000, renderMs: undefined })
    const stats = latencyStats([measured, unmeasured])

    expect(stats.count).toBe(2)
    expect(stats.renderUnmeasured).toBe(1)
    // render stats come only from the one sample that has a renderMs.
    expect(stats.segments.render).toEqual({ min: 16, median: 16, p95: 16, max: 16 })
    // stt (and the other non-render segments) still see both samples.
    expect(stats.segments.stt).toEqual({ min: 800, median: 900, p95: 1000, max: 1000 })
  })

  it('counts renderUnmeasured correctly across a mix of measured and unmeasured samples', () => {
    const stats = latencyStats([
      sample({ renderMs: 10 }),
      sample({ renderMs: undefined }),
      sample({ renderMs: undefined }),
      sample({ renderMs: 20 }),
    ])
    expect(stats.count).toBe(4)
    expect(stats.renderUnmeasured).toBe(2)
  })

  // `total` means "the sum of all four segments". A sample with no renderMs
  // therefore has no total either — it is excluded from `segments.total`,
  // the same way it is excluded from `segments.render`, rather than being
  // folded in as a 3-segment sum that would look like the same figure as
  // every other sample's 4-segment sum.
  it('excludes an unmeasured-render sample from total, rather than summing only its measured segments', () => {
    const measured = sample({ sttMs: 800, transportMs: 120, translationMs: 600, renderMs: 16 }) // total 1536
    const unmeasured = sample({ sttMs: 100, transportMs: 100, translationMs: 100, renderMs: undefined })
    const stats = latencyStats([measured, unmeasured])

    expect(stats.count).toBe(2)
    expect(stats.renderUnmeasured).toBe(1)
    // Only the fully-measured sample contributes to `total`.
    expect(stats.segments.total).toEqual({ min: 1536, median: 1536, p95: 1536, max: 1536 })
  })

  it('produces a zeroed total when no sample has a render measurement, even though count is nonzero', () => {
    const stats = latencyStats([sample({ renderMs: undefined }), sample({ renderMs: undefined })])
    expect(stats.count).toBe(2)
    expect(stats.renderUnmeasured).toBe(2)
    expect(stats.segments.total).toEqual({ min: 0, median: 0, p95: 0, max: 0 })
    expect(stats.segments.render).toEqual({ min: 0, median: 0, p95: 0, max: 0 })
    // stt is unaffected: it never depended on render being present.
    expect(stats.segments.stt).toEqual({ min: 800, median: 800, p95: 800, max: 800 })
  })
})
