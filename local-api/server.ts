/**
 * Local API сървър.
 *
 * Излиза от твоя BG residential IP към transport.plovdiv.bg.
 * Cloudflare Tunnel го прави достъпен публично на https://<random>.trycloudflare.com.
 * Vercel functions го извикват чрез този tunnel URL.
 */

import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { getStopETA, type ETAEntry } from './lib/zk-client.ts'
import { getStaticData } from './lib/static-data.ts'

const app = new Hono()

app.use('*', cors({ origin: '*' }))

app.get('/', (c) => c.text('transport-plovdiv local api (via Cloudflare Tunnel)'))
app.get('/health', (c) => c.json({ ok: true, ts: Date.now() }))

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

const ETA_CACHE_TTL_MS = 25_000
interface CachedEntry {
  etas: ETAEntry[]
  fetchedAt: number
}
const etaCache = new Map<number, CachedEntry>()
const inflight = new Map<number, Promise<ETAEntry[]>>()

app.get('/api/eta/:stop', async (c) => {
  const stopParam = c.req.param('stop')
  const stopNumber = parseInt(stopParam, 10)
  if (isNaN(stopNumber) || stopNumber < 0 || stopNumber > 9999) {
    return c.json({ error: 'invalid stop number' }, 400)
  }
  const force = c.req.query('force') === '1'

  try {
    const now = Date.now()
    if (force) etaCache.delete(stopNumber)
    const cached = etaCache.get(stopNumber)
    if (cached && now - cached.fetchedAt < ETA_CACHE_TTL_MS) {
      return c.json({
        stop: stopNumber,
        etas: cached.etas,
        fetchedAt: new Date(cached.fetchedAt).toISOString(),
        cached: true,
        ageSeconds: Math.floor((now - cached.fetchedAt) / 1000),
      })
    }

    let promise = inflight.get(stopNumber)
    if (!promise) {
      promise = getStopETA(stopNumber).finally(() => inflight.delete(stopNumber))
      inflight.set(stopNumber, promise)
    }
    const etas = await promise
    const fetchedAt = Date.now()
    etaCache.set(stopNumber, { etas, fetchedAt })

    return c.json({
      stop: stopNumber,
      etas,
      fetchedAt: new Date(fetchedAt).toISOString(),
      cached: false,
      ageSeconds: 0,
    })
  } catch (err) {
    return c.json(
      { error: 'upstream failed', details: err instanceof Error ? err.message : String(err) },
      502
    )
  }
})

const port = parseInt(process.env.PORT ?? '3001', 10)
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`✓ local-api listening on http://localhost:${info.port}`)
  console.log('  Cloudflare Tunnel ще го expose-не публично.')
})
