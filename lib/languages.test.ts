import { describe, it, expect } from 'vitest'
import { LANGUAGES, languageByCode } from './languages'

describe('LANGUAGES', () => {
  it('contains exactly English and Spanish', () => {
    expect(LANGUAGES.map((l) => l.code).sort()).toEqual(['en', 'es'])
  })

  it('gives every language a non-empty BCP-47 STT locale', () => {
    for (const lang of LANGUAGES) {
      expect(lang.sttLocale).toMatch(/^[a-z]{2}-[A-Z]{2}$/)
    }
  })

  it('gives every language a translateAs phrase for the prompt', () => {
    for (const lang of LANGUAGES) {
      expect(lang.translateAs.length).toBeGreaterThan(0)
    }
  })

  it('pins Spanish to neutral Latin American Spanish', () => {
    const es = languageByCode('es')
    expect(es?.translateAs).toContain('Latin American')
  })
})

describe('languageByCode', () => {
  it('finds a known language', () => {
    expect(languageByCode('en')?.label).toBe('English')
  })

  it('returns undefined for an unknown code', () => {
    expect(languageByCode('de')).toBeUndefined()
  })
})
