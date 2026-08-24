'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

interface SpeechRecognitionAlternative {
  transcript: string
}
interface SpeechRecognitionResult {
  isFinal: boolean
  0: SpeechRecognitionAlternative
}
interface SpeechRecognitionEvent extends Event {
  resultIndex: number
  results: { length: number; [i: number]: SpeechRecognitionResult }
}
interface SpeechRecognitionErrorEvent extends Event {
  error: string
}
interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  abort(): void
  onstart: (() => void) | null
  onresult: ((e: SpeechRecognitionEvent) => void) | null
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
}

type RecognitionCtor = new () => SpeechRecognitionLike

function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor
    webkitSpeechRecognition?: RecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

const MAX_BACKOFF_MS = 4000

export interface UseSpeechRecognitionOptions {
  locale: string
  enabled: boolean
  onInterim: (id: string, text: string) => void
  onFinal: (id: string, text: string) => void
}

export function useSpeechRecognition({
  locale,
  enabled,
  onInterim,
  onFinal,
}: UseSpeechRecognitionOptions) {
  // Tri-state: null until the capability check has run. Rendering "your
  // browser is unsupported" off a first-render `false` would flash that
  // message on every load in Chrome, so callers must treat null as unknown.
  const [supported, setSupported] = useState<boolean | null>(null)
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // User intent, not recognizer state. onend fires both when we stopped it
  // and when Chrome gave up on silence; without this the handler cannot tell
  // which happened, so it cannot know whether to re-arm.
  const wantActive = useRef(false)
  const backoff = useRef(0)
  const currentId = useRef<string | null>(null)
  const restartTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Keep callbacks in refs so changing them never tears down the recognizer.
  const interimCb = useRef(onInterim)
  const finalCb = useRef(onFinal)
  useEffect(() => {
    interimCb.current = onInterim
    finalCb.current = onFinal
  }, [onInterim, onFinal])

  const mintId = useCallback(() => {
    if (currentId.current === null) {
      currentId.current = crypto.randomUUID()
    }
    return currentId.current
  }, [])

  // Capability detection has to happen after mount: the server render has no
  // `window`, so probing during render would desync hydration. This sets state
  // exactly once and cannot cascade.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot capability report, see above
    setSupported(getRecognitionCtor() !== null)
  }, [])

  useEffect(() => {
    const Ctor = getRecognitionCtor()
    if (!Ctor || !enabled) return

    const rec = new Ctor()
    rec.lang = locale
    rec.continuous = true
    rec.interimResults = true

    // Wrapped because calling start() on an already-started recognizer
    // throws InvalidStateError.
    const safeStart = () => {
      try {
        rec.start()
      } catch {
        /* already started */
      }
    }

    rec.onstart = () => {
      setListening(true)
    }

    rec.onresult = (event) => {
      backoff.current = 0
      setError(null)
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const text = result[0].transcript.trim()

        if (result.isFinal) {
          if (text.length > 0) finalCb.current(mintId(), text)
          currentId.current = null // always clear on final, even when empty
        } else if (text.length > 0) {
          interimCb.current(mintId(), text)
        }
      }
    }

    rec.onerror = (event) => {
      setError(event.error)
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        wantActive.current = false // stop trying; the user must intervene
      } else {
        backoff.current = Math.min(backoff.current * 2 + 250, MAX_BACKOFF_MS)
      }
    }

    rec.onend = () => {
      setListening(false)
      // A session that ended without a final abandons its in-flight utterance;
      // the next session's first result is a new utterance, not a continuation.
      currentId.current = null
      if (!wantActive.current) return
      restartTimer.current = setTimeout(safeStart, backoff.current)
    }

    wantActive.current = true
    backoff.current = 0
    safeStart()

    return () => {
      wantActive.current = false
      if (restartTimer.current) {
        clearTimeout(restartTimer.current)
        restartTimer.current = null
      }
      rec.onstart = null
      rec.onresult = null
      rec.onerror = null
      rec.onend = null
      try {
        rec.abort()
      } catch {
        /* already stopped */
      }
      currentId.current = null
      setListening(false)
    }
    // `locale` is a dependency because SpeechRecognition.lang cannot change
    // mid-session — a locale change must tear down and rebuild the recognizer.
  }, [locale, enabled, mintId])

  return { supported, listening, error }
}
