import { describe, it, expect, vi, beforeEach } from 'vitest'

const create = vi.fn()

vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {}
  class APIConnectionError extends APIError {}
  class RateLimitError extends APIError {}

  class MockAnthropic {
    messages = { create }
    static APIError = APIError
    static APIConnectionError = APIConnectionError
    static RateLimitError = RateLimitError
  }

  return { default: MockAnthropic }
})

import { POST } from './route'

function post(body: unknown): Request {
  return new Request('http://localhost/api/translate', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  create.mockReset()
  create.mockResolvedValue({ content: [{ type: 'text', text: 'hello there' }] })
})

describe('POST /api/translate — guards', () => {
  it('rejects text longer than 500 characters', async () => {
    const res = await POST(post({ text: 'a'.repeat(501), srcLang: 'es', targetLang: 'en' }))
    expect(res.status).toBe(400)
    expect(create).not.toHaveBeenCalled()
  })

  it('accepts text of exactly 500 characters', async () => {
    const res = await POST(post({ text: 'a'.repeat(500), srcLang: 'es', targetLang: 'en' }))
    expect(res.status).toBe(200)
  })

  it('rejects a request whose source and target match', async () => {
    const res = await POST(post({ text: 'hola', srcLang: 'es', targetLang: 'es' }))
    expect(res.status).toBe(400)
    expect(create).not.toHaveBeenCalled()
  })

  it('rejects an unknown language code', async () => {
    const res = await POST(post({ text: 'hallo', srcLang: 'de', targetLang: 'en' }))
    expect(res.status).toBe(400)
    expect(create).not.toHaveBeenCalled()
  })

  it('rejects empty text', async () => {
    const res = await POST(post({ text: '', srcLang: 'es', targetLang: 'en' }))
    expect(res.status).toBe(400)
  })
})

describe('POST /api/translate — happy path', () => {
  it('returns the translation', async () => {
    const res = await POST(post({ text: 'hola', srcLang: 'es', targetLang: 'en' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ translation: 'hello there' })
  })

  it('calls the model with the pinned id and deterministic settings', async () => {
    await POST(post({ text: 'hola', srcLang: 'es', targetLang: 'en' }))
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-haiku-4-5',
        max_tokens: 300,
        temperature: 0,
      }),
    )
  })

  it('passes the speech text as the user message', async () => {
    await POST(post({ text: 'hola', srcLang: 'es', targetLang: 'en' }))
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ messages: [{ role: 'user', content: 'hola' }] }),
    )
  })

  it('ignores non-text content blocks', async () => {
    create.mockResolvedValue({
      content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'hello' }],
    })
    const res = await POST(post({ text: 'hola', srcLang: 'es', targetLang: 'en' }))
    expect(await res.json()).toEqual({ translation: 'hello' })
  })
})

describe('POST /api/translate — failures', () => {
  it('returns 502 when the model call throws', async () => {
    create.mockRejectedValue(new Error('boom'))
    const res = await POST(post({ text: 'hola', srcLang: 'es', targetLang: 'en' }))
    expect(res.status).toBe(502)
    expect(await res.json()).toHaveProperty('error')
  })

  it('returns 400 on a malformed body', async () => {
    const res = await POST(
      new Request('http://localhost/api/translate', { method: 'POST', body: 'not json' }),
    )
    expect(res.status).toBe(400)
  })

  it('returns 503 when the model rate limits', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default as unknown as {
      RateLimitError: new (m: string) => Error
    }
    create.mockRejectedValue(new Anthropic.RateLimitError('slow down'))
    const res = await POST(post({ text: 'hola', srcLang: 'es', targetLang: 'en' }))
    expect(res.status).toBe(503)
  })

  it('returns 503 when the upstream is unreachable', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default as unknown as {
      APIConnectionError: new (m: string) => Error
    }
    create.mockRejectedValue(new Anthropic.APIConnectionError('no route'))
    const res = await POST(post({ text: 'hola', srcLang: 'es', targetLang: 'en' }))
    expect(res.status).toBe(503)
  })
})
