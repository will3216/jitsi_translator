import { describe, it, expect } from 'vitest'
import { buildSystemPrompt } from './translatePrompt'
import { languageByCode } from './languages'

const en = languageByCode('en')!
const es = languageByCode('es')!

describe('buildSystemPrompt', () => {
  it('names both languages using their translateAs phrasing', () => {
    const prompt = buildSystemPrompt(es, en)
    expect(prompt).toContain('neutral Latin American Spanish')
    expect(prompt).toContain('into English')
  })

  it('instructs the model to emit only the translation', () => {
    expect(buildSystemPrompt(es, en)).toContain('Output ONLY the translation')
  })

  it('warns that the input is speech-to-text', () => {
    expect(buildSystemPrompt(es, en)).toContain('live speech-to-text')
  })

  it('includes recent context when given', () => {
    const prompt = buildSystemPrompt(es, en, ['we should rebase', 'agreed'])
    expect(prompt).toContain('we should rebase')
    expect(prompt).toContain('agreed')
  })

  it('omits the context block entirely when there is none', () => {
    expect(buildSystemPrompt(es, en)).not.toContain('Recent conversation')
    expect(buildSystemPrompt(es, en, [])).not.toContain('Recent conversation')
  })
})
