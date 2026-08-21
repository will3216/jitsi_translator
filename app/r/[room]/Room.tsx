'use client'

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { CaptionStream } from '@/components/CaptionStream'
import { LanguagePicker } from '@/components/LanguagePicker'
import { MicIndicator } from '@/components/MicIndicator'
import { Roster } from '@/components/Roster'
import { languageByCode } from '@/lib/languages'
import { initialLanguageSelection, nextLanguageSelection } from '@/lib/languageSelection'
import { initialRoomState, roomReducer } from '@/lib/roomReducer'
import type { Participant, Utterance } from '@/lib/types'
import { useAudioLevel } from '@/lib/useAudioLevel'
import { useSpeechRecognition } from '@/lib/useSpeechRecognition'
import { useTransport } from '@/lib/useTransport'

const CONTEXT_SIZE = 3

export default function Room({ roomId }: { roomId: string }) {
  const [state, dispatch] = useReducer(roomReducer, initialRoomState)
  const [languages, setLanguages] = useState(initialLanguageSelection)
  const speakLang = languages.speak
  const showLang = languages.show
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
  const level = useAudioLevel(micOn)

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
    <main className="grid h-screen grid-rows-[auto_1fr_auto] overflow-hidden">
      <header className="border-b border-white/10 px-6 py-3">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium tracking-tight">polyglot</span>
          <span className="text-xs text-[var(--muted)]">
            {transport.connected ? '●' : '○'} room {roomId}
          </span>
        </div>
        <div className="mt-2 flex gap-6">
          <LanguagePicker
            label="I speak"
            value={languages.speak}
            onChange={(value) =>
              setLanguages((s) => nextLanguageSelection(s, { field: 'speak', value }))
            }
          />
          <LanguagePicker
            label="Show me"
            value={languages.show}
            onChange={(value) =>
              setLanguages((s) => nextLanguageSelection(s, { field: 'show', value }))
            }
          />
        </div>
        <Roster participants={state.participants} meId={me.id} />

        <p>speech supported: {String(speech.supported)}</p>
        <p>speech error: {speech.error ?? 'none'}</p>
      </header>

      <section className="overflow-y-auto px-6 py-4">
        <CaptionStream utterances={state.utterances} />
      </section>

      <footer className="border-t border-white/10 px-6 py-3">
        {/* type-to-send lands here in Task 15 */}

        <MicIndicator active={micOn} level={level} onToggle={() => setMicOn((on) => !on)} />
      </footer>
    </main>
  )
}
