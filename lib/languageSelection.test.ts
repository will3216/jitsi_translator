import { describe, it, expect } from 'vitest'
import { initialLanguageSelection, nextLanguageSelection } from './languageSelection'

describe('nextLanguageSelection', () => {
  it('defaults both fields to the same language', () => {
    expect(initialLanguageSelection.speak).toBe(initialLanguageSelection.show)
  })

  it('carries "Show me" along when "I speak" changes', () => {
    const next = nextLanguageSelection(initialLanguageSelection, {
      field: 'speak',
      value: 'es',
    })
    expect(next.speak).toBe('es')
    expect(next.show).toBe('es')
  })

  it('marks "Show me" as touched when set directly', () => {
    const next = nextLanguageSelection(initialLanguageSelection, {
      field: 'show',
      value: 'es',
    })
    expect(next.show).toBe('es')
    expect(next.speak).toBe('en')
    expect(next.showTouched).toBe(true)
  })

  it('stops following once "Show me" has been touched', () => {
    let s = nextLanguageSelection(initialLanguageSelection, { field: 'show', value: 'es' })
    s = nextLanguageSelection(s, { field: 'speak', value: 'en' })
    expect(s.speak).toBe('en')
    expect(s.show).toBe('es')
  })

  it('keeps "Show me" touched after further speak changes', () => {
    let s = nextLanguageSelection(initialLanguageSelection, { field: 'show', value: 'es' })
    s = nextLanguageSelection(s, { field: 'speak', value: 'es' })
    expect(s.showTouched).toBe(true)
    expect(s.show).toBe('es')
  })
})
