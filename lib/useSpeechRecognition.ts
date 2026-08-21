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
  stop(): void
  abort(): void
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
  const [supported, setSupported] = useState(false)
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // User intent, not recognizer state. onend fires both when we stopped it
  // and when Chrome gave up on silence; without this the handler cannot tell
  // which happened, so it cannot know whether to re-arm.
  const wantActive = useRef(false)
  const backoff = useRef(0)
  const currentId = useRef<string | null>(null)
  const recognition = useRef<SpeechRecognitionLike | null>(null)
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

  useEffect(() => {
    setSupported(getRecognitionCtor() !== null)
  }, [])

  useEffect(() => {
    const Ctor = getRecognitionCtor()
    if (!Ctor || !enabled) return

    const rec = new Ctor()
    recognition.current = rec
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

    rec.onresult = (event) => {
      backoff.current = 0
      setError(null)
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const text = result[0].transcript.trim()
        if (text.length === 0) continue
        const id = mintId()
        if (result.isFinal) {
          finalCb.current(id, text)
          currentId.current = null // next utterance gets a fresh id
        } else {
          interimCb.current(id, text)
        }
      }
    }

    rec.onerror = (event) => {
      setError(event.error)
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        wantActive.current = false // stop trying; the user must intervene
      } else if (event.error === 'no-speech' || event.error === 'network') {
        backoff.current = Math.min(backoff.current * 2 + 250, MAX_BACKOFF_MS)
      }
    }

    rec.onend = () => {
      setListening(false)
      if (!wantActive.current) return
      restartTimer.current = setTimeout(safeStart, backoff.current)
    }

    wantActive.current = true
    backoff.current = 0
    setListening(true)
    safeStart()

    return () => {
      wantActive.current = false
      if (restartTimer.current) clearTimeout(restartTimer.current)
      rec.onresult = null
      rec.onerror = null
      rec.onend = null
      try {
        rec.abort()
      } catch {
        /* already stopped */
      }
      recognition.current = null
      setListening(false)
    }
    // `locale` is a dependency because SpeechRecognition.lang cannot change
    // mid-session — a locale change must tear down and rebuild the recognizer.
  }, [locale, enabled, mintId])

  return { supported, listening, error }
}
