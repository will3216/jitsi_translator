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
 *
 * Render is the one segment that can go unmeasured. It is captured via
 * requestAnimationFrame, and browsers do not run rAF in hidden tabs — and
 * this proof of concept is meant to run in a tab backgrounded behind a live
 * Jitsi call, so that is the normal case, not an edge case. Rather than
 * silently drop those utterances (leaving `stats()` looking complete while
 * quietly measuring nothing) or record a garbage renderMs equal to however
 * long the tab happened to stay hidden, `renderMs` is optional on a sample:
 * a hidden-tab utterance is still recorded, with every segment except
 * render, and `renderUnmeasured` in the stats says how many samples that
 * happened to. See recordTranslationEnd and recordPaint below.
 *
 * STT gets the same treatment for the same reason. A typed (type-to-send)
 * utterance never goes through speech recognition, so it has no sttMs —
 * but it still traverses transport, translation and render exactly like a
 * spoken one, and its latency there is exactly as real. Rather than exclude
 * typed utterances from measurement entirely (which would make this
 * instrumentation testable only by speaking into a microphone — the same
 * "must use a human voice" trap the project already hit once and escaped
 * with type-to-send), `sttMs` is optional on a sample: a typed utterance is
 * still recorded, with every segment except STT, and `sttUnmeasured` in the
 * stats says how many samples that happened to. A sample can be missing
 * sttMs, renderMs, or both — an entirely ordinary combination (a typed
 * utterance received in a backgrounded tab) — and each is tracked
 * independently.
 */

export interface LatencySample {
  id: string
  /** Absent when the utterance was typed rather than spoken — see the module doc. */
  sttMs?: number
  transportMs: number
  translationMs: number
  /** Absent when no paint could be measured for this sample — see the module doc. */
  renderMs?: number
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
  // How many of `count` samples have no sttMs (the utterance was typed
  // rather than spoken, so it never went through speech recognition).
  sttUnmeasured: number
  // How many of `count` samples have no renderMs (the receiving tab was
  // hidden, or a queued paint arrived implausibly late — see recordPaint).
  // Read alongside skewSuspected: together they say how far to trust each
  // number below rather than leaving that unstated.
  renderUnmeasured: number
  segments: {
    stt: SegmentStats
    transport: SegmentStats
    translation: SegmentStats
    render: SegmentStats
    total: SegmentStats
  }
}

interface PendingEntry {
  /** Absent for typed utterances — see the module doc. */
  sttMs?: number
  transportMs: number
  translationStartAt?: number // performance.now() at fetch start
  translationMs?: number
  translationEndAt?: number // performance.now() when the response arrived
}

// A real paint (rAF callback to browser paint) is a handful of milliseconds,
// never seconds. A queued rAF that fires this long after translationEndAt
// was not measuring a render — the tab was backgrounded for some or all of
// the wait — so its value is rejected rather than recorded. See recordPaint.
const RENDER_SANITY_BOUND_MS = 2000

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

/**
 * Record the arrival of a remote, translation-eligible utterance. `sttMs` is
 * absent for typed utterances, which never went through speech recognition
 * — see the module doc.
 */
export function recordArrival(id: string, ts: number, sttMs?: number): void {
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

/**
 * Push a completed sample, remove its pending entry, and emit the console
 * line. The one place that finalises a sample, so recordPaint's normal path
 * and recordTranslationEnd's hidden-tab fast path stay in sync.
 */
function finalizeSample(
  id: string,
  entry: Pick<PendingEntry, 'sttMs' | 'transportMs'> & { translationMs: number },
  renderMs: number | undefined,
): void {
  const sample: LatencySample = {
    id,
    sttMs: entry.sttMs,
    transportMs: entry.transportMs,
    translationMs: entry.translationMs,
    renderMs,
  }
  samples.push(sample)
  pending.delete(id)

  const sttPart = sample.sttMs === undefined ? 'stt=unmeasured' : `stt=${round(sample.sttMs)}ms`
  const renderPart = renderMs === undefined ? 'render=unmeasured' : `render=${round(renderMs)}ms`
  // `total` mirrors the aggregate rule below: it is only the sum of all four
  // segments, so a sample missing stt and/or render prints "unmeasured"
  // rather than a partial sum that would look like — but not be — the same
  // figure other lines report.
  const totalPart =
    sample.sttMs === undefined || renderMs === undefined
      ? 'total=unmeasured'
      : `total=${round(sample.sttMs + sample.transportMs + sample.translationMs + renderMs)}ms`
  console.log(
    `[latency] ${id} ${sttPart} transport=${round(sample.transportMs)}ms ` +
      `translation=${round(sample.translationMs)}ms ${renderPart} ${totalPart}`,
  )
}

/** Mark the arrival of the translation response for `id`. */
export function recordTranslationEnd(id: string): void {
  ensureWindowHook()
  const entry = pending.get(id)
  if (!entry || entry.translationStartAt === undefined) return
  const now = performance.now()
  entry.translationMs = now - entry.translationStartAt
  entry.translationEndAt = now

  // The receiving tab is not the foreground tab: requestAnimationFrame will
  // not run until (if ever) it becomes visible again. Waiting for that paint
  // would either strand this sample in `pending` forever, or — worse — let a
  // queued rAF fire much later with a renderMs spanning the whole hidden
  // interval. Close the sample now, with STT/transport/translation but no
  // render measurement, rather than gamble on either. This also means a
  // rAF already queued for `id` finds no pending entry when it eventually
  // runs and is a no-op — see recordPaint.
  if (typeof document !== 'undefined' && document.hidden) {
    finalizeSample(id, entry as { sttMs?: number; transportMs: number; translationMs: number }, undefined)
  }
}

/**
 * Mark the paint for `id`. Completes the sample and emits the console line.
 * No-op if the sample was never started, was abandoned mid-flight (e.g. a
 * stale-generation translation response that was discarded rather than
 * recorded — translationEndAt is missing and this quietly does nothing,
 * which is the desired "discarded, not recorded" behavior), or was already
 * finalised by recordTranslationEnd's hidden-tab fast path above (the entry
 * is gone from `pending` by the time this queued rAF runs).
 */
export function recordPaint(id: string): void {
  ensureWindowHook()
  const entry = pending.get(id)
  if (!entry || entry.translationMs === undefined || entry.translationEndAt === undefined) return

  const elapsed = performance.now() - entry.translationEndAt
  // Backstop for the narrower race where the tab was still visible when
  // translation ended (so the sample stayed open here rather than closing
  // in recordTranslationEnd) but was backgrounded before this queued frame
  // ran. An implausibly long elapsed time is evidence of exactly that, not
  // a render measurement, so it is rejected rather than recorded.
  const renderMs = elapsed > RENDER_SANITY_BOUND_MS ? undefined : elapsed

  finalizeSample(id, entry as { sttMs?: number; transportMs: number; translationMs: number }, renderMs)
}

/**
 * Discard a pending entry without ever producing a sample: used when a
 * translation fails, or when its generation goes stale before it resolves.
 * Together with finalizeSample (recordPaint, and recordTranslationEnd's
 * hidden-tab path) and resetLatency, this guarantees every entry that
 * recordArrival adds to `pending` is removed on exactly one of these paths —
 * none of them leave an entry behind.
 */
export function recordAbandoned(id: string): void {
  pending.delete(id)
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
 *
 * stt/render/total are each computed only from samples that have the
 * segment(s) they need. `total` means "the sum of all four segments", so a
 * sample missing stt and/or render has no total either — every sample still
 * counts toward `count` and toward whichever of stt/transport/translation/
 * render it does have, but a partial sum is never mixed into the same
 * distribution as a full 4-segment one under the same `total` label.
 */
export function latencyStats(input: LatencySample[] = samples): LatencyStats {
  const sttMeasured = input.filter((s): s is LatencySample & { sttMs: number } => s.sttMs !== undefined)
  const stt = sttMeasured.map((s) => s.sttMs)
  const transport = input.map((s) => s.transportMs)
  const translation = input.map((s) => s.translationMs)
  const renderMeasured = input.filter((s): s is LatencySample & { renderMs: number } => s.renderMs !== undefined)
  const render = renderMeasured.map((s) => s.renderMs)
  const fullyMeasured = input.filter(
    (s): s is LatencySample & { sttMs: number; renderMs: number } =>
      s.sttMs !== undefined && s.renderMs !== undefined,
  )
  const total = fullyMeasured.map((s) => s.sttMs + s.transportMs + s.translationMs + s.renderMs)

  return {
    count: input.length,
    skewSuspected: transport.some((t) => t < 0),
    sttUnmeasured: input.length - sttMeasured.length,
    renderUnmeasured: input.length - renderMeasured.length,
    segments: {
      stt: segmentStats(stt),
      transport: segmentStats(transport),
      translation: segmentStats(translation),
      render: segmentStats(render),
      total: segmentStats(total),
    },
  }
}
