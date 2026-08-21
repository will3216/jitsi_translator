'use client'

import { useEffect, useRef, useState } from 'react'
import type { RenderedUtterance } from '@/lib/types'
import { CaptionRow } from './CaptionRow'

export function CaptionStream({ utterances }: { utterances: RenderedUtterance[] }) {
  const bottom = useRef<HTMLDivElement>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const finalized = utterances.filter((u) => u.isFinal)
  const interim = utterances.filter((u) => !u.isFinal)

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' })
  }, [finalized.length, interim.length])

  return (
    <div className="flex flex-col">
      {finalized.map((u) => (
        <CaptionRow key={u.id} utterance={u} now={now} />
      ))}

      {interim.map((u) => (
        <p key={u.id} className="py-2 text-[var(--muted)] opacity-70">
          ░ {u.speakerName} is speaking… {u.text}
        </p>
      ))}

      <div ref={bottom} />
    </div>
  )
}
