'use client'

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { CaptionStream } from '@/components/CaptionStream'
import { LanguagePicker } from '@/components/LanguagePicker'
import { MicIndicator } from '@/components/MicIndicator'
import { Roster } from '@/components/Roster'
import { SecondWindowButton } from '@/components/SecondWindowButton'
import { TypeToSend } from '@/components/TypeToSend'
import { languageByCode } from '@/lib/languages'
import { initialLanguageSelection, nextLanguageSelection } from '@/lib/languageSelection'
import {
  recordAbandoned,
  recordArrival,
  recordPaint,
  recordTranslationEnd,
  recordTranslationStart,
} from '@/lib/latency'
import { initialRoomState, roomReducer } from '@/lib/roomReducer'
import type { LangCode, Participant, Utterance } from '@/lib/types'
import { useSpeechRecognition } from '@/lib/useSpeechRecognition'
import { useTransport } from '@/lib/useTransport'

const CONTEXT_SIZE = 3

/**
 * True only once `value` has stayed true for `ms`. The transport is legitimately
 * not connected for the first second or two of every load; shouting "not
 * connected" during a normal handshake would train the reader to ignore the
 * banner, which is exactly the failure this banner exists to prevent.
 */
function useSettled(value: boolean, ms: number): boolean {
  const [settled, setSettled] = useState(false)

  useEffect(() => {
    if (!value) return
    const timer = setTimeout(() => setSettled(true), ms)
    // Reset on the way out (value went false, or unmount) rather than in the
    // effect body — a synchronous setState there would cascade a render.
    return () => {
      clearTimeout(timer)
      setSettled(false)
    }
  }, [value, ms])

  return settled
}

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-white/10 bg-white/5 px-4 py-3 text-sm text-[var(--muted)]">
      {children}
    </div>
  )
}

export default function Room({
  roomId,
  speakParam,
  showParam,
}: {
  roomId: string
  speakParam?: string
  showParam?: string
}) {
  const [state, dispatch] = useReducer(roomReducer, initialRoomState)
  const [languages, setLanguages] = useState(() => {
    if (!speakParam && !showParam) return initialLanguageSelection
    const speak = languageByCode(speakParam ?? '')?.code ?? 'en'
    return {
      speak,
      // "Show me" follows "I speak" unless it was given explicitly —
      // the same rule nextLanguageSelection applies at runtime.
      show: showParam ? (languageByCode(showParam)?.code ?? 'en') : speak,
      showTouched: Boolean(showParam),
    }
  })
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

  // Read by the transport subscription and by the translate effect, both of
  // which run after commit — so this is written in an effect rather than
  // during render, which React Compiler (rightly) forbids.
  const showLangRef = useRef(showLang)

  // Anything the reducer put into 'pending' needs a translation. The set of
  // ids already requested is what stops a re-render from firing a second call.
  const requested = useRef(new Set<string>())

  // Bumped every time "Show me" changes. A reply from a request issued under
  // the old target must not be written onto an utterance that has since been
  // re-queued for a different language.
  const targetGeneration = useRef(0)

  // Changing "Show me" has to re-translate what is already on screen —
  // otherwise the reader switches language and every caption they can see
  // stays in the one they could not read. Clearing `requested` is not
  // optional: without it the guard above blocks every re-request and the
  // re-target is silently a no-op.
  useEffect(() => {
    showLangRef.current = showLang
    requested.current.clear()
    targetGeneration.current += 1
    dispatch({ type: 'target/changed', myTarget: showLang })
  }, [showLang])

  // Receive remote utterances.
  useEffect(() => {
    return transport.subscribe((u) => {
      // Only remote, final utterances that actually need translation are
      // worth timing — interim revisions have no sttMs yet, and one whose
      // source already matches the reader's target never enters the
      // translation pipeline, so it would never complete a sample.
      if (u.isFinal && u.srcLang !== showLangRef.current && typeof u.sttMs === 'number') {
        recordArrival(u.id, u.ts, u.sttMs)
      }
      dispatch({ type: 'utterance/received', utterance: u, myTarget: showLangRef.current })
    })
  }, [transport])

  useEffect(() => {
    dispatch({ type: 'participants/synced', participants: transport.participants })
  }, [transport.participants])

  // Emit locally first, then publish — do not wait for the round trip.
  const emit = useCallback(
    (id: string, text: string, isFinal: boolean, sttMs?: number) => {
      const u: Utterance = {
        id,
        speakerId: me.id,
        speakerName: me.name,
        srcLang: me.srcLang,
        text,
        isFinal,
        ts: Date.now(),
        ...(sttMs !== undefined ? { sttMs } : {}),
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
  const onFinal = useCallback(
    (id: string, text: string, sttMs: number) => emit(id, text, true, sttMs),
    [emit],
  )

  const sendTyped = useCallback(
    (text: string) => emit(crypto.randomUUID(), text, true),
    [emit],
  )

  const alone = state.participants.filter((p) => p.id !== me.id).length === 0
  const otherLang: LangCode = languages.show === 'en' ? 'es' : 'en'

  const locale = languageByCode(speakLang)?.sttLocale ?? 'en-US'
  const speech = useSpeechRecognition({ locale, enabled: micOn, onInterim, onFinal })

  useEffect(() => {
    const pending = state.utterances.filter(
      (u) => u.translationState === 'pending' && !requested.current.has(u.id),
    )

    for (const u of pending) {
      requested.current.add(u.id)
      const generation = targetGeneration.current

      const context = state.utterances
        .filter((c) => c.isFinal && c.id !== u.id)
        .slice(-CONTEXT_SIZE)
        .map((c) => c.text)

      recordTranslationStart(u.id)

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
        .then(({ translation }) => {
          // A stale generation's sample is discarded, not recorded: skip
          // marking translation end/paint, and drop the pending entry so it
          // does not sit there unresolved for the rest of the call.
          if (targetGeneration.current !== generation) {
            recordAbandoned(u.id)
            return
          }
          recordTranslationEnd(u.id)
          dispatch({ type: 'translation/succeeded', id: u.id, translation })
          requestAnimationFrame(() => recordPaint(u.id))
        })
        .catch(() => {
          // A failed translation will never produce a sample either way;
          // drop its pending entry regardless of generation.
          recordAbandoned(u.id)
          if (targetGeneration.current !== generation) return
          dispatch({ type: 'translation/failed', id: u.id })
        })
    }
  }, [state.utterances])

  // `supported` is null until the capability probe runs after mount, so this
  // stays false on the first render in every browser — no unsupported flash.
  const micUnsupported = speech.supported === false
  const disconnected = useSettled(!transport.connected, 2500)

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
      </header>

      <section className="overflow-y-auto px-6 py-4">
        {/* Banners only ever sit above the stream. Nothing may replace it:
            an utterance that was accepted must always be on screen, and a
            room whose transport is dead is exactly when that matters most. */}
        {disconnected ? (
          <Banner>
            {/* Deliberately no second-window button: opening another window
                cannot repair a connection that is not there. */}
            Not connected to the room. Anything you say or type is still shown
            here, but it is not reaching anyone else yet.
          </Banner>
        ) : alone ? (
          <Banner>
            <span>You&apos;re the only one here.</span>
            <SecondWindowButton roomId={roomId} otherLang={otherLang} />
          </Banner>
        ) : null}

        {micUnsupported && (
          <Banner>
            Live captions from your voice need the browser&apos;s built-in speech
            recognition, which only desktop Chrome provides. Everything else works
            here — you can read the room and type below.
          </Banner>
        )}

        <CaptionStream utterances={state.utterances} />
      </section>

      <footer className="border-t border-white/10 px-6 py-3">
        <div className="flex items-center gap-4">
          <TypeToSend onSend={sendTyped} />
          <MicIndicator
            active={micOn}
            onToggle={() => setMicOn((on) => !on)}
            disabled={micUnsupported}
            title={micUnsupported ? 'Speech recognition needs desktop Chrome' : undefined}
          />
        </div>
        {speech.error === 'not-allowed' && (
          <p className="mt-2 text-xs text-[var(--muted)]">
            Microphone blocked. Click the camera icon in Chrome&apos;s address bar,
            allow the microphone, then reload. You can still type below.
          </p>
        )}
      </footer>
    </main>
  )
}
