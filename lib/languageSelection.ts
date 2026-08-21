import type { LangCode } from './types'

export interface LanguageSelection {
  speak: LangCode
  show: LangCode
  showTouched: boolean
}

export const initialLanguageSelection: LanguageSelection = {
  speak: 'en',
  show: 'en',
  showTouched: false,
}

export function nextLanguageSelection(
  current: LanguageSelection,
  change: { field: 'speak' | 'show'; value: LangCode },
): LanguageSelection {
  if (change.field === 'show') {
    return { ...current, show: change.value, showTouched: true }
  }
  return {
    ...current,
    speak: change.value,
    // "Show me" follows "I speak" until the user touches it directly.
    show: current.showTouched ? current.show : change.value,
  }
}
