import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { getStopETA, type ETAEntry } from './zk-client.js'
import { getStaticData } from './static-data.js'

const app = new Hono()

// CORS_ORIGIN може да е "*" или comma-separated списък от origin-и
const corsOrigins = (process.env.CORS_ORIGIN ?? '*')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

app.use(
  '*',
  cors({
    origin: corsOrigins.length === 1 && corsOrigins[0] === '*' ? '*' : corsOrigins,
  })
)

app.get('/', (c) => c.text('transport-plovdiv api'))

// Health check за Railway
app.get('/health', (c) => c.json({ ok: true, ts: Date.now() }))

app.get('/api/stops', async (c) => {
  try {
    const data = await getStaticData()
    return c.json({ stops: data.stops, loadedAt: data.loadedAt })
  } catch (err) {
    return c.json(
      { error: 'static load failed', details: err instanceof Error ? err.message : String(err) },
      502
    )
  }
})

app.get('/api/lines', async (c) => {
  try {
    const data = await getStaticData()
    return c.json({ lines: data.lines, loadedAt: data.loadedAt })
  } catch (err) {
    return c.json(
      { error: 'static load failed', details: err instanceof Error ? err.message : String(err) },
      502
    )
  }
})

const CACHE_TTL_MS = 25_000

interface CachedEntry {
  etas: ETAEntry[]
  fetchedAt: number
}
const etaCache = new Map<number, CachedEntry>()
const inflight = new Map<number, Promise<ETAEntry[]>>()

async function fetchETACached(stopNumber: number): Promise<{
  etas: ETAEntry[]
  fetchedAt: number
  cached: boolean
}> {
  const now = Date.now()
  const cached = etaCache.get(stopNumber)
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return { etas: cached.etas, fetchedAt: cached.fetchedAt, cached: true }
  }

  // Coalesce concurrent requests for same stop
  let promise = inflight.get(stopNumber)
  if (!promise) {
    promise = getStopETA(stopNumber).finally(() => {
      inflight.delete(stopNumber)
    })
    inflight.set(stopNumber, promise)
  }

  const etas = await promise
  const fetchedAt = Date.now()
  etaCache.set(stopNumber, { etas, fetchedAt })
  return { etas, fetchedAt, cached: false }
}

app.get('/api/eta/:stop', async (c) => {
  const stopParam = c.req.param('stop')
  const stopNumber = parseInt(stopParam, 10)
  if (isNaN(stopNumber) || stopNumber < 0 || stopNumber > 9999) {
    return c.json({ error: 'invalid stop number' }, 400)
  }
  const force = c.req.query('force') === '1'

  try {
    if (force) {
      etaCache.delete(stopNumber)
      // Не изтриваме inflight - ако друг потребител чака същата заявка,
      // връщаме му свежите данни също. Това е feature, не bug.
    }
    const { etas, fetchedAt, cached } = await fetchETACached(stopNumber)
    return c.json({
      stop: stopNumber,
      etas,
      fetchedAt: new Date(fetchedAt).toISOString(),
      cached,
      ageSeconds: Math.floor((Date.now() - fetchedAt) / 1000),
    })
  } catch (err) {
    return c.json(
      {
        error: 'upstream failed',
        details: err instanceof Error ? err.message : String(err),
      },
      502
    )
  }
})

const port = parseInt(process.env.PORT ?? '3001', 10)
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`)
})
