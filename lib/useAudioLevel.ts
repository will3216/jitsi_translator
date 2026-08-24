'use client'

import { useEffect, useState } from 'react'

export function useAudioLevel(active: boolean): { level: number; error: boolean } {
  const [level, setLevel] = useState(0)
  const [error, setError] = useState(false)

  // The setState calls below reset the meter when the mic is switched off and
  // report a getUserMedia rejection. Both are one-shot edges driven by an
  // external system (the media device), not a render-derived value, so they
  // cannot cascade.
  useEffect(() => {
    if (!active) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
      setLevel(0)
      setError(false)
      return
    }

    let stream: MediaStream | null = null
    let context: AudioContext | null = null
    let frame = 0
    let cancelled = false

    void navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((granted) => {
        if (cancelled) {
          granted.getTracks().forEach((t) => t.stop())
          return
        }
        stream = granted
        context = new AudioContext()
        const analyser = context.createAnalyser()
        analyser.fftSize = 512
        context.createMediaStreamSource(granted).connect(analyser)

        const samples = new Uint8Array(analyser.frequencyBinCount)
        const tick = () => {
          analyser.getByteTimeDomainData(samples)
          let peak = 0
          for (const sample of samples) {
            peak = Math.max(peak, Math.abs(sample - 128) / 128)
          }
          setLevel(peak)
          frame = requestAnimationFrame(tick)
        }
        tick()
      })
      .catch(() => {
        if (cancelled) return
        setLevel(0)
        setError(true)
      })

    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      stream?.getTracks().forEach((t) => t.stop())
      void context?.close()
      setLevel(0)
    }
  }, [active])

  return { level, error }
}
