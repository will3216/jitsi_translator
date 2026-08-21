import type { LangCode, Participant, RenderedUtterance, Utterance } from './types'

export interface RoomState {
  utterances: RenderedUtterance[]
  participants: Participant[]
}

export type RoomAction =
  | { type: 'utterance/received'; utterance: Utterance; myTarget: LangCode }
  | { type: 'participants/synced'; participants: Participant[] }

export const initialRoomState: RoomState = {
  utterances: [],
  participants: [],
}

function stateForUtterance(
  _u: Utterance,
  _myTarget: LangCode,
): RenderedUtterance['translationState'] {
  return 'none'
}

function byTimestamp(a: RenderedUtterance, b: RenderedUtterance): number {
  return a.ts - b.ts
}

export function roomReducer(state: RoomState, action: RoomAction): RoomState {
  switch (action.type) {
    case 'utterance/received': {
      const incoming = action.utterance
      const existing = state.utterances.find((u) => u.id === incoming.id)

      if (!existing) {
        const next: RenderedUtterance = {
          ...incoming,
          translationState: stateForUtterance(incoming, action.myTarget),
        }
        return { ...state, utterances: [...state.utterances, next].sort(byTimestamp) }
      }

      // A stale interim must never undo a final result.
      if (existing.isFinal && !incoming.isFinal) return state

      const merged: RenderedUtterance = {
        ...existing,
        text: incoming.text,
        isFinal: incoming.isFinal,
        ts: existing.ts, // first emit wins
      }

      return {
        ...state,
        utterances: state.utterances
          .map((u) => (u.id === merged.id ? merged : u))
          .sort(byTimestamp),
      }
    }

    case 'participants/synced':
      return { ...state, participants: action.participants }

    default:
      return state
  }
}
