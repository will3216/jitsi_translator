import { languageByCode } from '@/lib/languages'
import type { RenderedUtterance } from '@/lib/types'

function speakerColor(speakerId: string): string {
  const hues = [200, 320, 40, 150, 270]
  let hash = 0
  for (let i = 0; i < speakerId.length; i++) hash = (hash * 31 + speakerId.charCodeAt(i)) | 0
  return `hsl(${hues[Math.abs(hash) % hues.length]} 70% 65%)`
}

function relativeTime(ts: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - ts) / 1000))
  if (seconds < 2) return 'now'
  if (seconds < 60) return `${seconds}s`
  return `${Math.round(seconds / 60)}m`
}

export function CaptionRow({
  utterance,
  now,
}: {
  utterance: RenderedUtterance
  now: number
}) {
  const source = languageByCode(utterance.srcLang)
  const showsTranslation = utterance.translationState === 'done' && utterance.translation

  return (
    <article className="min-h-[5.5rem] py-3">
      <div className="flex items-baseline justify-between text-xs">
        <span style={{ color: speakerColor(utterance.speakerId) }}>
          ● {utterance.speakerName} · {source?.nativeLabel}
        </span>
        <span className="text-[var(--muted)] opacity-60">
          {relativeTime(utterance.ts, now)}
        </span>
      </div>

      {/* Source sits above the target, smaller and dimmed, whenever a
          translation is being shown. When none is needed, the source IS the
          primary line and is rendered large below instead. */}
      {showsTranslation && (
        <p className="text-base opacity-55">{utterance.text}</p>
      )}

      <p className="text-xl">
        {showsTranslation ? utterance.translation : utterance.text}
      </p>

      {utterance.translationState === 'pending' && (
        <p className="text-xs text-[var(--muted)] opacity-70">translating…</p>
      )}

      {utterance.translationState === 'failed' && (
        <p className="text-xs text-[var(--muted)] opacity-70">translation unavailable</p>
      )}
    </article>
  )
}
