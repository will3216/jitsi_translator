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

  if (finalized.length === 0 && interim.length === 0) {
    return (
      <div className="min-h-[5.5rem] pointer-events-none select-none py-3 opacity-25">
        <p className="text-xs">● Ana · Español</p>
        <p className="text-base opacity-55">Creo que deberíamos fusionar ese PR primero</p>
        <p className="text-xl">I think we should merge that PR first.</p>
      </div>
    )
  }

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
