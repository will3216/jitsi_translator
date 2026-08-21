import Ably from 'ably'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request): Promise<Response> {
  const clientId = new URL(req.url).searchParams.get('clientId')
  if (!clientId) {
    return Response.json({ error: 'clientId is required' }, { status: 400 })
  }

  const key = process.env.ABLY_API_KEY
  if (!key) {
    return Response.json({ error: 'transport not configured' }, { status: 500 })
  }

  try {
    const rest = new Ably.Rest(key)
    const tokenRequest = await rest.auth.createTokenRequest({ clientId })
    return Response.json(tokenRequest)
  } catch {
    return Response.json({ error: 'could not mint a token' }, { status: 502 })
  }
}
