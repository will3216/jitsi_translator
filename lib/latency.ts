/**
 * Latency instrumentation for the captions pipeline.
 *
 * A sample tracks four segments for one translated remote utterance:
 *
 *   STT         speech start -> final recognised            (sender-local)
 *   Transport   sender's ts -> arrival at the receiver       (cross-clock)
 *   Translation fetch sent -> response received              (receiver-local)
 *   Render      response received -> painted                 (receiver-local)
 *
 * Only remote utterances that actually get translated are sampled: our own
 * utterances render instantly (transport would read ~0 and drag every
 * statistic toward zero), and utterances that need no translation never
 * enter the pending-translation pipeline at all.
 *
 * STT and Translation/Render durations use monotonic clocks local to a
 * single machine (sender's Date.now() difference for STT; receiver's
 * performance.now() for translation/render), so they are unaffected by
 * clock skew between machines. Transport is the one segment that compares
 * a timestamp from one machine's Date.now() against another's, so it is the
 * only segment a clock-skewed pair of machines can make look wrong — see
 * `skewSuspected` below.
 */

export interface LatencySample {
  id: string
  sttMs: number
  transportMs: number
  translationMs: number
  renderMs: number
}

export interface SegmentStats {
  min: number
  median: number
  p95: number
  max: number
}

export interface LatencyStats {
  count: number
  // True once any sample shows a negative transport duration — proof the
  // sender and receiver clocks disagree. Reported, never hidden: a negative
  // sample is left as-is (not clamped to zero) so the evidence stays visible.
  skewSuspected: boolean
  segments: {
    stt: SegmentStats
    transport: SegmentStats
    translation: SegmentStats
    render: SegmentStats
    total: SegmentStats
  }
}

interface PendingEntry {
  sttMs: number
  transportMs: number
  translationStartAt?: number // performance.now() at fetch start
  translationMs?: number
  translationEndAt?: number // performance.now() when the response arrived
}

const pending = new Map<string, PendingEntry>()
let samples: LatencySample[] = []

function round(n: number): number {
  return Math.round(n)
}

function ensureWindowHook(): void {
  if (typeof window === 'undefined') return
  const w = window as unknown as { polyglotLatency?: unknown }
  if (w.polyglotLatency) return
  Object.assign(window, {
    polyglotLatency: {
      stats: () => latencyStats(),
      reset: resetLatency,
      raw: rawLatencySamples,
    },
  })
}

/** Record the arrival of a remote, translation-eligible utterance. */
export function recordArrival(id: string, ts: number, sttMs: number): void {
  ensureWindowHook()
  const transportMs = Date.now() - ts
  pending.set(id, { sttMs, transportMs })
}

/** Mark the start of the translation fetch for `id`. No-op for ids never seen by recordArrival. */
export function recordTranslationStart(id: string): void {
  ensureWindowHook()
  const entry = pending.get(id)
  if (!entry) return
  entry.translationStartAt = performance.now()
}

/** Mark the arrival of the translation response for `id`. */
export function recordTranslationEnd(id: string): void {
  ensureWindowHook()
  const entry = pending.get(id)
  if (!entry || entry.translationStartAt === undefined) return
  const now = performance.now()
  entry.translationMs = now - entry.translationStartAt
  entry.translationEndAt = now
}

/**
 * Mark the paint for `id`. Completes the sample and emits the console line.
 * No-op if the sample was never started, or was abandoned mid-flight (e.g.
 * a stale-generation translation response that was discarded rather than
 * recorded) — in that case translationEndAt is missing and this quietly
 * does nothing, which is the desired "discarded, not recorded" behavior.
 */
export function recordPaint(id: string): void {
  ensureWindowHook()
  const entry = pending.get(id)
  if (!entry || entry.translationMs === undefined || entry.translationEndAt === undefined) return

  const renderMs = performance.now() - entry.translationEndAt
  const sample: LatencySample = {
    id,
    sttMs: entry.sttMs,
    transportMs: entry.transportMs,
    translationMs: entry.translationMs,
    renderMs,
  }
  samples.push(sample)
  pending.delete(id)

  const total = sample.sttMs + sample.transportMs + sample.translationMs + sample.renderMs
  console.log(
    `[latency] ${id} stt=${round(sample.sttMs)}ms transport=${round(sample.transportMs)}ms ` +
      `translation=${round(sample.translationMs)}ms render=${round(sample.renderMs)}ms total=${round(total)}ms`,
  )
}

/** Discard whatever has been recorded so far, including in-flight samples. */
export function resetLatency(): void {
  pending.clear()
  samples = []
}

/** The raw completed samples, in completion order. */
export function rawLatencySamples(): LatencySample[] {
  return [...samples]
}

function emptySegment(): SegmentStats {
  return { min: 0, median: 0, p95: 0, max: 0 }
}

function median(sorted: number[]): number {
  const n = sorted.length
  const mid = Math.floor(n / 2)
  if (n % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2
  return sorted[mid]
}

function p95(sorted: number[]): number {
  const n = sorted.length
  const idx = Math.min(n - 1, Math.max(0, Math.ceil(0.95 * n) - 1))
  return sorted[idx]
}

function segmentStats(values: number[]): SegmentStats {
  if (values.length === 0) return emptySegment()
  const sorted = [...values].sort((a, b) => a - b)
  return {
    min: sorted[0],
    median: median(sorted),
    p95: p95(sorted),
    max: sorted[sorted.length - 1],
  }
}

/**
 * Pure percentile maths over a set of samples. Defaults to the module's own
 * completed samples, but takes an explicit array so it can be unit tested
 * without touching window/performance globals.
 */
export function latencyStats(input: LatencySample[] = samples): LatencyStats {
  const stt = input.map((s) => s.sttMs)
  const transport = input.map((s) => s.transportMs)
  const translation = input.map((s) => s.translationMs)
  const render = input.map((s) => s.renderMs)
  const total = input.map((s) => s.sttMs + s.transportMs + s.translationMs + s.renderMs)

  return {
    count: input.length,
    skewSuspected: transport.some((t) => t < 0),
    segments: {
      stt: segmentStats(stt),
      transport: segmentStats(transport),
      translation: segmentStats(translation),
      render: segmentStats(render),
      total: segmentStats(total),
    },
  }
}
