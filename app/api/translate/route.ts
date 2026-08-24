import Anthropic from '@anthropic-ai/sdk'
import { languageByCode } from '@/lib/languages'
import { buildSystemPrompt } from '@/lib/translatePrompt'

export const runtime = 'nodejs'

const MAX_TEXT_LENGTH = 500
const MODEL = 'claude-haiku-4-5'

function bad(error: string): Response {
  return Response.json({ error }, { status: 400 })
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return bad('malformed JSON body')
  }

  const { text, srcLang, targetLang, context } = (body ?? {}) as {
    text?: unknown
    srcLang?: unknown
    targetLang?: unknown
    context?: unknown
  }

  if (typeof text !== 'string' || text.length === 0) return bad('text is required')
  if (text.length > MAX_TEXT_LENGTH) return bad(`text exceeds ${MAX_TEXT_LENGTH} characters`)
  if (typeof srcLang !== 'string' || typeof targetLang !== 'string') {
    return bad('srcLang and targetLang are required')
  }
  // The client should never ask for this; if it does, that is a reducer bug
  // and it should surface loudly rather than silently cost money.
  if (srcLang === targetLang) return bad('srcLang and targetLang must differ')

  const src = languageByCode(srcLang)
  const target = languageByCode(targetLang)
  if (!src || !target) return bad('unknown language code')

  const recent = Array.isArray(context)
    ? context.filter((c): c is string => typeof c === 'string')
    : undefined

  const client = new Anthropic()

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 300,
      temperature: 0,
      system: buildSystemPrompt(src, target, recent),
      messages: [{ role: 'user', content: text }],
    })

    // response.content is a discriminated union — narrow before reading .text.
    const translation = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim()

    return Response.json({ translation })
  } catch (err) {
    // A dead API key (401), a bad model id (404) and an exhausted quota all
    // collapse into the same 502 for the client, which is correct — the
    // browser must never see upstream detail — but it leaves the operator
    // with nothing to act on. This is the only place that distinction exists.
    // Never log the key or any part of it.
    const detail =
      err instanceof Anthropic.APIError
        ? { name: err.name, status: err.status, message: err.message }
        : err instanceof Error
          ? { name: err.name, message: err.message }
          : { name: 'unknown', message: String(err) }
    console.error('[translate] upstream failure', { model: MODEL, ...detail })

    // Most specific first. APIConnectionError extends APIError in this SDK,
    // so it must be checked before APIError.
    if (err instanceof Anthropic.RateLimitError) {
      return Response.json({ error: 'rate limited' }, { status: 503 })
    }
    if (err instanceof Anthropic.APIConnectionError) {
      return Response.json({ error: 'upstream unreachable' }, { status: 503 })
    }
    if (err instanceof Anthropic.APIError) {
      return Response.json({ error: 'translation upstream error' }, { status: 502 })
    }
    return Response.json({ error: 'translation failed' }, { status: 502 })
  }
}
