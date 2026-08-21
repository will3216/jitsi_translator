'use client'

import { useEffect, useState } from 'react'

export function useAudioLevel(active: boolean): number {
  const [level, setLevel] = useState(0)

  useEffect(() => {
    if (!active) {
      setLevel(0)
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
      .catch(() => setLevel(0))

    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      stream?.getTracks().forEach((t) => t.stop())
      void context?.close()
      setLevel(0)
    }
  }, [active])

  return level
}
