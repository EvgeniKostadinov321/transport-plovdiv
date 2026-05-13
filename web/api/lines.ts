/**
 * Vercel function: /api/lines
 *
 * Forwards към API_BACKEND_URL (Cloudflare Tunnel към твоя PC).
 * Vercel не може директно да достигне transport.plovdiv.bg (datacenter IP блокиране),
 * затова заявката минава през tunnel-а.
 */

export const config = { runtime: 'nodejs' }

const BACKEND = process.env.API_BACKEND_URL ?? ''

export default async function handler(_req: Request) {
  if (!BACKEND) {
    return Response.json({ error: 'API_BACKEND_URL not configured' }, { status: 500 })
  }
  try {
    const res = await fetch(`${BACKEND.replace(/\/$/, '')}/api/lines`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(25000),
    })
    const body = await res.text()
    return new Response(body, {
      status: res.status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 's-maxage=86400, max-age=300',
      },
    })
  } catch (err) {
    return Response.json(
      { error: 'backend unreachable', details: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    )
  }
}
