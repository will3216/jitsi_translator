'use client'

import { useAudioLevel } from '@/lib/useAudioLevel'

const BARS = [0.15, 0.4, 0.7, 0.4, 0.15]

export function MicIndicator({
  active,
  onToggle,
}: {
  active: boolean
  onToggle: () => void
}) {
  const { level, error } = useAudioLevel(active)

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={onToggle}
        aria-pressed={active}
        className="rounded-full border border-white/20 px-4 py-2 text-sm"
      >
        {active ? '🎙 on' : '🎙 off'}
      </button>

      <div
        className="flex h-6 items-end gap-1"
        role={error ? 'img' : undefined}
        aria-label={error ? 'microphone unavailable' : undefined}
        aria-hidden={error ? undefined : true}
      >
        {error ? (
          <span className="h-[2px] w-9 rounded-full bg-[var(--muted)] opacity-60" />
        ) : (
          BARS.map((weight, i) => (
            <span
              key={i}
              className="w-1 rounded-full bg-[var(--fg)]"
              style={{
                height: `${Math.max(2, level * weight * 100)}%`,
                opacity: active ? 0.8 : 0.2,
              }}
            />
          ))
        )}
      </div>
    </div>
  )
}
