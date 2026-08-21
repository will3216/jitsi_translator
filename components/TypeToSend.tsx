'use client'

import { useState } from 'react'

export function TypeToSend({ onSend }: { onSend: (text: string) => void }) {
  const [text, setText] = useState('')

  return (
    <form
      className="flex flex-1 items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        const trimmed = text.trim()
        if (trimmed.length === 0) return
        onSend(trimmed)
        setText('')
      }}
    >
      <label className="text-sm text-[var(--muted)]" htmlFor="type-to-send">
        or type:
      </label>
      <input
        id="type-to-send"
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={500}
        className="flex-1 rounded border border-white/15 bg-transparent px-3 py-2 text-sm"
      />
    </form>
  )
}
