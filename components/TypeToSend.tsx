'use client'

import { useState } from 'react'
import { MAX_SEND_LENGTH, validateSendText } from '@/lib/sendValidation'

export function TypeToSend({ onSend }: { onSend: (text: string) => void }) {
  const [text, setText] = useState('')

  return (
    <form
      className="flex flex-1 items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        const result = validateSendText(text)
        if (!result.ok || result.text === undefined) return
        onSend(result.text)
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
        maxLength={MAX_SEND_LENGTH}
        className="flex-1 rounded border border-white/15 bg-transparent px-3 py-2 text-sm"
      />
    </form>
  )
}
