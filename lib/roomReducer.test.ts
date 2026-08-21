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

describe('roomReducer — translation state machine', () => {
  it('marks a foreign-language final utterance pending', () => {
    const state = receive(initialRoomState, utterance({ srcLang: 'es', isFinal: true }), 'en')
    expect(state.utterances[0].translationState).toBe('pending')
  })

  it('never marks an interim utterance pending', () => {
    const state = receive(initialRoomState, utterance({ srcLang: 'es', isFinal: false }), 'en')
    expect(state.utterances[0].translationState).toBe('none')
  })

  it('needs no translation when the source is already my target', () => {
    const state = receive(initialRoomState, utterance({ srcLang: 'en', isFinal: true }), 'en')
    expect(state.utterances[0].translationState).toBe('none')
  })

  it('patches in a completed translation', () => {
    let state = receive(initialRoomState, utterance({ srcLang: 'es', isFinal: true }), 'en')
    state = roomReducer(state, {
      type: 'translation/succeeded',
      id: 'u1',
      translation: 'hello',
    })
    expect(state.utterances[0].translationState).toBe('done')
    expect(state.utterances[0].translation).toBe('hello')
  })

  it('marks a failed translation without dropping the utterance', () => {
    let state = receive(initialRoomState, utterance({ srcLang: 'es', isFinal: true }), 'en')
    state = roomReducer(state, { type: 'translation/failed', id: 'u1' })
    expect(state.utterances[0].translationState).toBe('failed')
    expect(state.utterances[0].text).toBe('hola')
  })

  it('ignores a translation result for an utterance that is not pending', () => {
    let state = receive(initialRoomState, utterance({ srcLang: 'en', isFinal: true }), 'en')
    state = roomReducer(state, {
      type: 'translation/succeeded',
      id: 'u1',
      translation: 'should not appear',
    })
    expect(state.utterances[0].translationState).toBe('none')
    expect(state.utterances[0].translation).toBeUndefined()
  })

  it('lets an id leave pending exactly once', () => {
    let state = receive(initialRoomState, utterance({ srcLang: 'es', isFinal: true }), 'en')
    state = roomReducer(state, { type: 'translation/succeeded', id: 'u1', translation: 'hello' })
    state = roomReducer(state, { type: 'translation/succeeded', id: 'u1', translation: 'clobbered' })
    expect(state.utterances[0].translation).toBe('hello')
  })

  it('does not re-trigger translation when a stale interim lands after done', () => {
    let state = receive(initialRoomState, utterance({ srcLang: 'es', isFinal: true }), 'en')
    state = roomReducer(state, { type: 'translation/succeeded', id: 'u1', translation: 'hello' })
    state = receive(state, utterance({ srcLang: 'es', isFinal: false, text: 'stale' }), 'en')
    expect(state.utterances[0].translationState).toBe('done')
    expect(state.utterances[0].translation).toBe('hello')
  })

  it('does not reset a completed translation when a second final arrives', () => {
    let state = receive(initialRoomState, utterance({ srcLang: 'es', isFinal: true }), 'en')
    state = roomReducer(state, { type: 'translation/succeeded', id: 'u1', translation: 'hello' })
    state = receive(state, utterance({ srcLang: 'es', isFinal: true, text: 'edited final' }), 'en')
    expect(state.utterances[0].translationState).toBe('done')
    expect(state.utterances[0].translation).toBe('hello')
    expect(state.utterances[0].text).toBe('edited final')
  })

  it('preserves both utterances and relative order when two share an identical timestamp', () => {
    let state = receive(initialRoomState, utterance({ id: 'a', ts: 1000 }))
    state = receive(state, utterance({ id: 'b', ts: 1000 }))
    expect(state.utterances).toHaveLength(2)
    expect(state.utterances.map((u) => u.id)).toEqual(['a', 'b'])
  })
})

describe('roomReducer — target/changed', () => {
  it('marks a final utterance pending when re-targeted to a foreign language', () => {
    let state = receive(initialRoomState, utterance({ srcLang: 'es', isFinal: true }), 'es')
    expect(state.utterances[0].translationState).toBe('none')
    state = roomReducer(state, { type: 'target/changed', myTarget: 'en' })
    expect(state.utterances[0].translationState).toBe('pending')
  })

  it("marks a final utterance none when re-targeted to the utterance's own language", () => {
    let state = receive(initialRoomState, utterance({ srcLang: 'es', isFinal: true }), 'en')
    state = roomReducer(state, { type: 'translation/succeeded', id: 'u1', translation: 'hello' })
    state = roomReducer(state, { type: 'target/changed', myTarget: 'es' })
    expect(state.utterances[0].translationState).toBe('none')
    expect(state.utterances[0].translation).toBeUndefined()
  })

  it('drops a stale translation when re-targeted to another foreign language', () => {
    let state = receive(initialRoomState, utterance({ srcLang: 'es', isFinal: true }), 'en')
    state = roomReducer(state, { type: 'translation/succeeded', id: 'u1', translation: 'hello' })
    state = roomReducer(state, { type: 'target/changed', myTarget: 'en' })
    expect(state.utterances[0].translationState).toBe('pending')
    expect(state.utterances[0].translation).toBeUndefined()
  })

  it('leaves interim utterances untouched', () => {
    let state = receive(
      initialRoomState,
      utterance({ srcLang: 'es', isFinal: false, text: 'hola' }),
      'es',
    )
    state = roomReducer(state, { type: 'target/changed', myTarget: 'en' })
    expect(state.utterances[0].translationState).toBe('none')
    expect(state.utterances[0].isFinal).toBe(false)
    expect(state.utterances[0].text).toBe('hola')
  })

  it('gives a failed utterance another chance', () => {
    let state = receive(initialRoomState, utterance({ srcLang: 'es', isFinal: true }), 'en')
    state = roomReducer(state, { type: 'translation/failed', id: 'u1' })
    expect(state.utterances[0].translationState).toBe('failed')
    state = roomReducer(state, { type: 'target/changed', myTarget: 'en' })
    expect(state.utterances[0].translationState).toBe('pending')
  })

  it('does not mutate the previous state', () => {
    const before = receive(initialRoomState, utterance({ srcLang: 'es', isFinal: true }), 'en')
    const withTranslation = roomReducer(before, {
      type: 'translation/succeeded',
      id: 'u1',
      translation: 'hello',
    })
    roomReducer(withTranslation, { type: 'target/changed', myTarget: 'es' })
    expect(withTranslation.utterances[0].translation).toBe('hello')
    expect(withTranslation.utterances[0].translationState).toBe('done')
  })
})
