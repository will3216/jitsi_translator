import type { Language } from './types'

export const LANGUAGES: Language[] = [
  {
    code: 'en',
    sttLocale: 'en-US',
    label: 'English',
    nativeLabel: 'English',
    translateAs: 'English',
    script: 'latin',
  },
  {
    code: 'es',
    sttLocale: 'es-MX',
    label: 'Spanish',
    nativeLabel: 'Español',
    translateAs:
      'neutral Latin American Spanish (no vosotros, no peninsular vocabulary)',
    script: 'latin',
  },
]

export function languageByCode(code: string): Language | undefined {
  return LANGUAGES.find((l) => l.code === code)
}
