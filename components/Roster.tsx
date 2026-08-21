import { languageByCode } from '@/lib/languages'
import type { Participant } from '@/lib/types'

export function Roster({
  participants,
  meId,
}: {
  participants: Participant[]
  meId: string
}) {
  if (participants.length === 0) return null

  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--muted)]">
      {participants.map((p) => (
        <li key={p.id}>
          {p.name}
          {p.id === meId && ' (you)'} · {languageByCode(p.srcLang)?.nativeLabel}
        </li>
      ))}
    </ul>
  )
}
