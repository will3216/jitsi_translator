'use client'

import { LANGUAGES } from '@/lib/languages'
import type { LangCode } from '@/lib/types'

export function LanguagePicker({
  label,
  value,
  onChange,
}: {
  label: string
  value: LangCode
  onChange: (value: LangCode) => void
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-[var(--muted)]">
      {label}
      <select
        className="rounded border border-white/15 bg-transparent px-2 py-1 text-[var(--fg)]"
        value={value}
        onChange={(e) => onChange(e.target.value as LangCode)}
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code} className="bg-[var(--bg)]">
            {l.nativeLabel}
          </option>
        ))}
      </select>
    </label>
  )
}
