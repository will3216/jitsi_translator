import { describe, it, expect } from 'vitest'
import { roomReducer, initialRoomState, type RoomState } from './roomReducer'
import type { Utterance } from './types'

function utterance(over: Partial<Utterance> = {}): Utterance {
  return {
    id: 'u1',
    speakerId: 'p1',
    speakerName: 'Ana',
    srcLang: 'es',
    text: 'hola',
    isFinal: false,
    ts: 1000,
    ...over,
  }
}

function receive(state: RoomState, u: Utterance, myTarget: 'en' | 'es' = 'en') {
  return roomReducer(state, { type: 'utterance/received', utterance: u, myTarget })
}

describe('roomReducer — utterance upsert', () => {
  it('inserts a new interim utterance', () => {
    const state = receive(initialRoomState, utterance())
    expect(state.utterances).toHaveLength(1)
    expect(state.utterances[0].text).toBe('hola')
  })

  it('replaces text on an interim revision instead of appending', () => {
    let state = receive(initialRoomState, utterance({ text: 'hola' }))
    state = receive(state, utterance({ text: 'hola que tal' }))
    expect(state.utterances).toHaveLength(1)
    expect(state.utterances[0].text).toBe('hola que tal')
  })

  it('keeps the first-emit timestamp across revisions', () => {
    let state = receive(initialRoomState, utterance({ ts: 1000 }))
    state = receive(state, utterance({ ts: 9999, text: 'hola que tal' }))
    expect(state.utterances[0].ts).toBe(1000)
  })

  it('keeps utterances ordered by first-emit timestamp', () => {
    let state = receive(initialRoomState, utterance({ id: 'b', ts: 2000 }))
    state = receive(state, utterance({ id: 'a', ts: 1000 }))
    expect(state.utterances.map((u) => u.id)).toEqual(['a', 'b'])
  })

  it('promotes an utterance to final', () => {
    let state = receive(initialRoomState, utterance())
    state = receive(state, utterance({ text: 'hola que tal', isFinal: true }))
    expect(state.utterances[0].isFinal).toBe(true)
    expect(state.utterances[0].text).toBe('hola que tal')
  })

  it('ignores an interim revision that arrives after the final', () => {
    let state = receive(initialRoomState, utterance({ text: 'final text', isFinal: true }))
    state = receive(state, utterance({ text: 'stale interim', isFinal: false }))
    expect(state.utterances[0].text).toBe('final text')
    expect(state.utterances[0].isFinal).toBe(true)
  })
})

describe('roomReducer — presence', () => {
  it('replaces the participant list', () => {
    const state = roomReducer(initialRoomState, {
      type: 'participants/synced',
      participants: [{ id: 'p1', name: 'Ana', srcLang: 'es' }],
    })
    expect(state.participants).toHaveLength(1)
    expect(state.participants[0].name).toBe('Ana')
  })

  it('does not disturb utterances when presence changes', () => {
    let state = receive(initialRoomState, utterance())
    state = roomReducer(state, { type: 'participants/synced', participants: [] })
    expect(state.utterances).toHaveLength(1)
  })
})
