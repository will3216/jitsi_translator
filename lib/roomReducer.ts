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
  | { type: 'target/changed'; myTarget: LangCode }

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

    // "Show me" changed. Everything already final on screen has to be
    // re-evaluated against the new target, or the reader keeps staring at
    // captions in the language they just said they cannot read. Any existing
    // translation is stale by definition, so it is dropped. Interim text is
    // never translated, so it is left exactly as it is.
    case 'target/changed':
      return {
        ...state,
        utterances: state.utterances.map((u) => {
          if (!u.isFinal) return u
          const next: RenderedUtterance = {
            ...u,
            translationState: stateForUtterance(u, action.myTarget),
          }
          delete next.translation // the copy is fresh; `u` is untouched
          return next
        }),
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
