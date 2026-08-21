import { describe, it, expect, vi, beforeEach } from 'vitest'

const createTokenRequest = vi.fn()

vi.mock('ably', () => {
  class MockRest {
    auth = { createTokenRequest }
  }
  return { default: { Rest: MockRest }, Rest: MockRest }
})

import { GET } from './route'

function get(url: string): Request {
  return new Request(url)
}

beforeEach(() => {
  createTokenRequest.mockReset()
  createTokenRequest.mockResolvedValue({ keyName: 'k', nonce: 'n', mac: 'm' })
  process.env.ABLY_API_KEY = 'test-key'
})

describe('GET /api/realtime-token', () => {
  it('requires a clientId', async () => {
    const res = await GET(get('http://localhost/api/realtime-token'))
    expect(res.status).toBe(400)
    expect(createTokenRequest).not.toHaveBeenCalled()
  })

  it('mints a token request scoped to the clientId', async () => {
    const res = await GET(get('http://localhost/api/realtime-token?clientId=abc'))
    expect(res.status).toBe(200)
    expect(createTokenRequest).toHaveBeenCalledWith({ clientId: 'abc' })
    expect(await res.json()).toEqual({ keyName: 'k', nonce: 'n', mac: 'm' })
  })

  it('fails cleanly when the server key is missing', async () => {
    delete process.env.ABLY_API_KEY
    const res = await GET(get('http://localhost/api/realtime-token?clientId=abc'))
    expect(res.status).toBe(500)
  })
})
