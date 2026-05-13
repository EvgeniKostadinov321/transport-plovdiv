import { getStopETA, type ETAEntry } from '../_lib/zk-client.js'

export const config = {
  runtime: 'nodejs',
}

// In-memory cache (живее през lifetime-а на serverless invocation-а)
const CACHE_TTL_MS = 25_000

interface CachedEntry {
  etas: ETAEntry[]
  fetchedAt: number
}
const etaCache = new Map<number, CachedEntry>()
const inflight = new Map<number, Promise<ETAEntry[]>>()

async function fetchETACached(
  stopNumber: number,
  force: boolean
): Promise<{ etas: ETAEntry[]; fetchedAt: number; cached: boolean }> {
  const now = Date.now()
  if (force) etaCache.delete(stopNumber)
  const cached = etaCache.get(stopNumber)
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return { etas: cached.etas, fetchedAt: cached.fetchedAt, cached: true }
  }
  let promise = inflight.get(stopNumber)
  if (!promise) {
    promise = getStopETA(stopNumber).finally(() => inflight.delete(stopNumber))
    inflight.set(stopNumber, promise)
  }
  const etas = await promise
  const fetchedAt = Date.now()
  etaCache.set(stopNumber, { etas, fetchedAt })
  return { etas, fetchedAt, cached: false }
}

export default async function handler(req: Request) {
  const url = new URL(req.url)
  // Vercel dynamic route param: /api/eta/27 -> pathname /api/eta/27
  const parts = url.pathname.split('/').filter(Boolean)
  const stopParam = parts[parts.length - 1]
  const stopNumber = parseInt(stopParam, 10)
  if (isNaN(stopNumber) || stopNumber < 0 || stopNumber > 9999) {
    return Response.json({ error: 'invalid stop number' }, { status: 400 })
  }
  const force = url.searchParams.get('force') === '1'

  try {
    const { etas, fetchedAt, cached } = await fetchETACached(stopNumber, force)
    return Response.json({
      stop: stopNumber,
      etas,
      fetchedAt: new Date(fetchedAt).toISOString(),
      cached,
      ageSeconds: Math.floor((Date.now() - fetchedAt) / 1000),
    })
  } catch (err) {
    return Response.json(
      {
        error: 'upstream failed',
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    )
  }
}
