import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ArrivalQueue } from './arrivalQueue'

describe('ArrivalQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves immediately when an item arrived before next() was called', async () => {
    const q = new ArrivalQueue<number>()
    q.push(1)
    await expect(q.next()).resolves.toBe(1)
  })

  it('returns multiple queued arrivals in FIFO order', async () => {
    const q = new ArrivalQueue<number>()
    q.push(1)
    q.push(2)
    q.push(3)
    await expect(q.next()).resolves.toBe(1)
    await expect(q.next()).resolves.toBe(2)
    await expect(q.next()).resolves.toBe(3)
  })

  it('waits for an arrival when called against an empty queue', async () => {
    const q = new ArrivalQueue<number>()
    const promise = q.next()

    let resolved = false
    promise.then(() => {
      resolved = true
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(resolved).toBe(false)

    q.push(42)
    await expect(promise).resolves.toBe(42)
  })

  it('resolves null on timeout', async () => {
    const q = new ArrivalQueue<number>()
    const promise = q.next(1000)
    await vi.advanceTimersByTimeAsync(1000)
    await expect(promise).resolves.toBeNull()
  })

  it('does not resolve early, before the timeout elapses', async () => {
    const q = new ArrivalQueue<number>()
    const promise = q.next(1000)

    let settled = false
    promise.then(() => {
      settled = true
    })

    await vi.advanceTimersByTimeAsync(999)
    expect(settled).toBe(false)

    q.push(7)
    await expect(promise).resolves.toBe(7)
  })

  it('stops delivering to a subscriber once unsubscribed', () => {
    const q = new ArrivalQueue<number>()
    const received: number[] = []
    const unsubscribe = q.subscribe((v) => received.push(v))

    q.push(1)
    unsubscribe()
    q.push(2)

    expect(received).toEqual([1])
  })

  it('caps the queue and drops the oldest item once the cap is exceeded', async () => {
    const q = new ArrivalQueue<number>(3)
    q.push(1)
    q.push(2)
    q.push(3)
    q.push(4) // should drop 1

    await expect(q.next()).resolves.toBe(2)
    await expect(q.next()).resolves.toBe(3)
    await expect(q.next()).resolves.toBe(4)
  })

  it('clear() drops queued items still waiting to be consumed', async () => {
    const q = new ArrivalQueue<number>()
    q.push(1)

    q.clear()

    // The item queued before clear() is gone: a next() call afterwards must
    // wait for a fresh arrival rather than immediately returning the stale one.
    const promise = q.next(50)
    let settled = false
    promise.then(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)

    await vi.advanceTimersByTimeAsync(50)
    await expect(promise).resolves.toBeNull()
  })

  it('clear() drops all subscribers', () => {
    const q = new ArrivalQueue<number>()
    const received: number[] = []
    q.subscribe((v) => received.push(v))

    q.clear()
    q.push(1)

    expect(received).toEqual([])
  })
})
