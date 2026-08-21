'use client'

import { languageByCode } from '@/lib/languages'
import type { LangCode } from '@/lib/types'

export function SecondWindowButton({
  roomId,
  otherLang,
}: {
  roomId: string
  otherLang: LangCode
}) {
  const label = languageByCode(otherLang)?.nativeLabel ?? otherLang

  return (
    <button
      className="rounded border border-white/20 px-3 py-2 text-sm"
      onClick={() =>
        window.open(
          `/r/${roomId}?speak=${otherLang}&show=${otherLang}`,
          '_blank',
          'width=900,height=760',
        )
      }
    >
      Open a second window as {label}
    </button>
  )
}
