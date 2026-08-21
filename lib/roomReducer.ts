import type { LangCode, Participant, RenderedUtterance, Utterance } from './types'

export interface RoomState {
  utterances: RenderedUtterance[]
  participants: Participant[]
}

export type RoomAction =
  | { type: 'utterance/received'; utterance: Utterance; myTarget: LangCode }
  | { type: 'participants/synced'; participants: Participant[] }
  | { type: 'translation/succeeded'; id: string; translation: string }
  | { type: 'translation/failed'; id: string }

export const initialRoomState: RoomState = {
  utterances: [],
  participants: [],
}

function stateForUtterance(
  u: Utterance,
  myTarget: LangCode,
): RenderedUtterance['translationState'] {
  // Interim text is never translated — it is about to change.
  if (!u.isFinal) return 'none'
  // Source already matches my target: render the source as the primary line.
  if (u.srcLang === myTarget) return 'none'
  return 'pending'
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
        translationState:
          incoming.isFinal && !existing.isFinal
            ? stateForUtterance(incoming, action.myTarget)
            : existing.translationState,
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

    case 'translation/succeeded':
      return {
        ...state,
        utterances: state.utterances.map((u) =>
          u.id === action.id && u.translationState === 'pending'
            ? { ...u, translation: action.translation, translationState: 'done' as const }
            : u,
        ),
      }

    case 'translation/failed':
      return {
        ...state,
        utterances: state.utterances.map((u) =>
          u.id === action.id && u.translationState === 'pending'
            ? { ...u, translationState: 'failed' as const }
            : u,
        ),
      }

    default:
      return state
  }
}
