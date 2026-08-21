'use client'

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { LANGUAGES, languageByCode } from '@/lib/languages'
import { initialRoomState, roomReducer } from '@/lib/roomReducer'
import type { LangCode, Participant, Utterance } from '@/lib/types'
import { useSpeechRecognition } from '@/lib/useSpeechRecognition'
import { useTransport } from '@/lib/useTransport'

const CONTEXT_SIZE = 3

export default function Room({ roomId }: { roomId: string }) {
  const [state, dispatch] = useReducer(roomReducer, initialRoomState)
  const [speakLang, setSpeakLang] = useState<LangCode>('en')
  const [showLang, setShowLang] = useState<LangCode>('en')
  const [micOn, setMicOn] = useState(false)

  const [myId] = useState(() => crypto.randomUUID())
  const [myName] = useState(() => `guest-${Math.random().toString(36).slice(2, 5)}`)

  const me: Participant = useMemo(
    () => ({ id: myId, name: myName, srcLang: speakLang }),
    [myId, myName, speakLang],
  )

  const transport = useTransport(roomId, me)
  const showLangRef = useRef(showLang)
  showLangRef.current = showLang

  // Receive remote utterances.
  useEffect(() => {
    return transport.subscribe((u) => {
      dispatch({ type: 'utterance/received', utterance: u, myTarget: showLangRef.current })
    })
  }, [transport])

  useEffect(() => {
    dispatch({ type: 'participants/synced', participants: transport.participants })
  }, [transport.participants])

  // Emit locally first, then publish — do not wait for the round trip.
  const emit = useCallback(
    (id: string, text: string, isFinal: boolean) => {
      const u: Utterance = {
        id,
        speakerId: me.id,
        speakerName: me.name,
        srcLang: me.srcLang,
        text,
        isFinal,
        ts: Date.now(),
      }
      dispatch({ type: 'utterance/received', utterance: u, myTarget: showLangRef.current })
      transport.publish(u)
    },
    [me, transport],
  )

  const onInterim = useCallback(
    (id: string, text: string) => emit(id, text, false),
    [emit],
  )
  const onFinal = useCallback((id: string, text: string) => emit(id, text, true), [emit])

  const locale = languageByCode(speakLang)?.sttLocale ?? 'en-US'
  const speech = useSpeechRecognition({ locale, enabled: micOn, onInterim, onFinal })

  // Anything the reducer put into 'pending' needs a translation. The set of
  // ids already requested is what stops a re-render from firing a second call.
  const requested = useRef(new Set<string>())

  useEffect(() => {
    const pending = state.utterances.filter(
      (u) => u.translationState === 'pending' && !requested.current.has(u.id),
    )

    for (const u of pending) {
      requested.current.add(u.id)

      const context = state.utterances
        .filter((c) => c.isFinal && c.id !== u.id)
        .slice(-CONTEXT_SIZE)
        .map((c) => c.text)

      fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: u.text,
          srcLang: u.srcLang,
          targetLang: showLangRef.current,
          context,
        }),
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(`translate failed: ${res.status}`)
          return (await res.json()) as { translation: string }
        })
        .then(({ translation }) =>
          dispatch({ type: 'translation/succeeded', id: u.id, translation }),
        )
        .catch(() => dispatch({ type: 'translation/failed', id: u.id }))
    }
  }, [state.utterances])

  return (
    <main>
      <p>room {roomId}</p>
      <p>connected: {String(transport.connected)}</p>
      <p>speech supported: {String(speech.supported)}</p>
      <p>speech error: {speech.error ?? 'none'}</p>

      <label>
        I speak{' '}
        <select value={speakLang} onChange={(e) => setSpeakLang(e.target.value as LangCode)}>
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
      </label>

      <label>
        Show me{' '}
        <select value={showLang} onChange={(e) => setShowLang(e.target.value as LangCode)}>
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
      </label>

      <button onClick={() => setMicOn((on) => !on)}>
        {micOn ? 'stop mic' : 'start mic'}
      </button>

      <ul>
        {state.participants.map((p) => (
          <li key={p.id}>
            {p.name} ({p.srcLang})
          </li>
        ))}
      </ul>

      <ol>
        {state.utterances.map((u) => (
          <li key={u.id}>
            <b>{u.speakerName}</b> [{u.srcLang}] {u.text}
            {u.translationState === 'pending' && <> — translating…</>}
            {u.translationState === 'done' && <> — {u.translation}</>}
            {u.translationState === 'failed' && <> — translation unavailable</>}
          </li>
        ))}
      </ol>
    </main>
  )
}
