'use client'

import { useSyncExternalStore } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { languageByCode } from '@/lib/languages'
import type { RenderedUtterance } from '@/lib/types'

function speakerColor(speakerId: string): string {
  // 12 hues, evenly spaced 30° apart around the wheel, phase-shifted so
  // none lands near 0/360 (pure red reads as an error state — the nearest
  // hues, 15 and 345, sit a full 15° clear of it on either side). At 70%
  // saturation / 65% lightness on the near-black --bg (#0b0b0d) all twelve
  // stay legible and distinct from one another.
  const hues = [15, 45, 75, 105, 135, 165, 195, 225, 255, 285, 315, 345]
  let hash = 0
  for (let i = 0; i < speakerId.length; i++) hash = (hash * 31 + speakerId.charCodeAt(i)) | 0
  return `hsl(${hues[Math.abs(hash) % hues.length]} 70% 65%)`
}

function subscribeVisibility(onChange: () => void): () => void {
  document.addEventListener('visibilitychange', onChange)
  return () => document.removeEventListener('visibilitychange', onChange)
}

/**
 * A background tab is the normal case here — the premise is reading this
 * beside a Jitsi call in another window. `AnimatePresence mode="popLayout"`
 * absolutely-positions the exiting node and waits for its exit animation to
 * finish; with no requestAnimationFrame ticks in a hidden tab that never
 * happens, so the old text sits on top of the new one indefinitely.
 * useSyncExternalStore keeps this SSR-safe and reactive, unlike reading
 * document.hidden during render.
 */
function useDocumentHidden(): boolean {
  return useSyncExternalStore(
    subscribeVisibility,
    () => document.hidden,
    () => false,
  )
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
  const reduceMotion = useReducedMotion()
  const hidden = useDocumentHidden()

  return (
    <motion.article
      className="relative min-h-[5.5rem] py-3"
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
    >
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
          primary line and is rendered large below instead. While a
          translation is pending, this slot holds a placeholder note instead
          of the source, so the large line's vertical position never shifts
          when the translation lands. */}
      {showsTranslation && (
        <p className="text-base opacity-55">{utterance.text}</p>
      )}

      {utterance.translationState === 'pending' && (
        <p className="text-base opacity-55 text-[var(--muted)]">translating…</p>
      )}

      {hidden ? (
        <p className="text-xl">
          {showsTranslation ? utterance.translation : utterance.text}
        </p>
      ) : (
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.p
            key={showsTranslation ? 'translation' : 'source'}
            className="text-xl"
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduceMotion ? { opacity: 1 } : { opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.18 }}
          >
            {showsTranslation ? utterance.translation : utterance.text}
          </motion.p>
        </AnimatePresence>
      )}

      {utterance.translationState === 'failed' && (
        <p className="text-xs text-[var(--muted)] opacity-70">translation unavailable</p>
      )}
    </motion.article>
  )
}
