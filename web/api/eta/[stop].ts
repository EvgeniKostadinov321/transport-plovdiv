/**
 * Vercel function: /api/eta/:stop - forwards към backend tunnel.
 */

export const config = { runtime: 'nodejs' }

const BACKEND = process.env.API_BACKEND_URL ?? ''

export default async function handler(req: Request) {
  if (!BACKEND) {
    return Response.json({ error: 'API_BACKEND_URL not configured' }, { status: 500 })
  }
  const url = new URL(req.url, 'http://localhost')
  const stopParam =
    url.searchParams.get('stop') ??
    url.pathname.split('/').filter(Boolean).pop() ??
    ''
  const stopNumber = parseInt(stopParam, 10)
  if (isNaN(stopNumber) || stopNumber < 0 || stopNumber > 9999) {
    return Response.json({ error: 'invalid stop number' }, { status: 400 })
  }

  const force = url.searchParams.get('force') === '1'
  const backendUrl = `${BACKEND.replace(/\/$/, '')}/api/eta/${stopNumber}${force ? '?force=1' : ''}`

  try {
    const res = await fetch(backendUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(25000),
    })
    const body = await res.text()
    return new Response(body, {
      status: res.status,
      headers: {
        'Content-Type': 'application/json',
      },
    })
  } catch (err) {
    return Response.json(
      { error: 'backend unreachable', details: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    )
  }
}
