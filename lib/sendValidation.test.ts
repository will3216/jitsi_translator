import { describe, it, expect } from 'vitest'
import { MAX_SEND_LENGTH, validateSendText } from './sendValidation'

describe('validateSendText', () => {
  it('trims surrounding whitespace and accepts the result', () => {
    const result = validateSendText('  hello there  ')
    expect(result.ok).toBe(true)
    expect(result.text).toBe('hello there')
  })

  it('rejects an empty string', () => {
    expect(validateSendText('').ok).toBe(false)
  })

  it('rejects whitespace-only input', () => {
    expect(validateSendText('   \n\t  ').ok).toBe(false)
  })

  it(`accepts text exactly ${MAX_SEND_LENGTH} characters after trimming`, () => {
    const text = 'a'.repeat(MAX_SEND_LENGTH)
    const result = validateSendText(text)
    expect(result.ok).toBe(true)
    expect(result.text).toBe(text)
  })

  it(`rejects text over ${MAX_SEND_LENGTH} characters after trimming`, () => {
    const text = 'a'.repeat(MAX_SEND_LENGTH + 1)
    expect(validateSendText(text).ok).toBe(false)
  })

  it('measures the length limit after trimming, not before', () => {
    // Padding that would push it over the limit before trim, but not after.
    const padded = '  ' + 'a'.repeat(MAX_SEND_LENGTH) + '  '
    const result = validateSendText(padded)
    expect(result.ok).toBe(true)
    expect(result.text).toBe('a'.repeat(MAX_SEND_LENGTH))
  })

  it('does not return text on rejection', () => {
    const result = validateSendText('')
    expect(result.text).toBeUndefined()
  })
})
