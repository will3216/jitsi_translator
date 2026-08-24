/**
 * A cursor-based FIFO queue of arrived items, paired with a plain
 * subscriber list — the shared machinery behind `window.polyglot.onUtterance`
 * and `window.polyglot.nextUtterance`.
 *
 * The cursor property is the whole point: a naive `nextUtterance()` that
 * only ever waits for a *future* push races the sender. If the item already
 * arrived before `next()` was called, a listener-only implementation misses
 * it and hangs forever — indistinguishable from a real bug. `push()` always
 * enqueues, and `next()` drains the queue before it ever waits, so an
 * arrival is never lost to timing.
 *
 * The queue is capped (oldest dropped first) so that an item nobody ever
 * calls `next()` for does not grow the queue without bound.
 */
export class ArrivalQueue<T> {
  private queue: T[] = []
  private waiters: Array<(value: T | null) => void> = []
  private subscribers = new Set<(value: T) => void>()

  constructor(private readonly cap = 100) {}

  /** Enqueue an arrival, notify subscribers, and resolve the oldest waiter, if any. */
  push(value: T): void {
    for (const cb of this.subscribers) cb(value)

    const waiter = this.waiters.shift()
    if (waiter) {
      waiter(value)
      return
    }

    this.queue.push(value)
    if (this.queue.length > this.cap) this.queue.shift()
  }

  /**
   * Resolves with the next arrival. If one is already queued, resolves
   * immediately with it (FIFO). Otherwise waits for the next `push()`, or
   * resolves `null` after `timeoutMs`.
   */
  next(timeoutMs = 30000): Promise<T | null> {
    if (this.queue.length > 0) {
      return Promise.resolve(this.queue.shift() as T)
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const idx = this.waiters.indexOf(settle)
        if (idx !== -1) this.waiters.splice(idx, 1)
        resolve(null)
      }, timeoutMs)

      const settle = (value: T | null) => {
        clearTimeout(timer)
        resolve(value)
      }

      this.waiters.push(settle)
    })
  }

  /** Subscribe to every future arrival. Returns an unsubscribe function. */
  subscribe(cb: (value: T) => void): () => void {
    this.subscribers.add(cb)
    return () => {
      this.subscribers.delete(cb)
    }
  }

  /** Empty the queue and drop all subscribers. Waiters already pending still time out normally. */
  clear(): void {
    this.queue = []
    this.subscribers.clear()
  }
}
