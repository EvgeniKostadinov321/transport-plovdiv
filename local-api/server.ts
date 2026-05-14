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
import { liveTransport } from './lib/livetransport-client.ts'
import { getTripsForLine, getVehicleTripStatus } from './lib/trips-client.ts'

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

app.get('/api/line/:line/trips', async (c) => {
  const line = c.req.param('line')
  if (!/^[0-9A-Za-z]{1,5}$/.test(line)) {
    return c.json({ error: 'invalid line' }, 400)
  }
  try {
    const trips = await getTripsForLine(line)
    // Кеш-вaмe в edge защото shape-ите рядко се променят. PER_LINE_TTL_MS = 5 min.
    c.header('Cache-Control', 'public, max-age=120')
    return c.json({ line, trips })
  } catch (err) {
    return c.json(
      { error: 'trips fetch failed', details: err instanceof Error ? err.message : String(err) },
      502
    )
  }
})

/**
 * Trip status за конкретен автобус.
 * `:id` е URL-encoded (`3/PB0533CE` → `3%2FPB0533CE`).
 */
app.get('/api/vehicle/:id/trip', async (c) => {
  const vehicleId = decodeURIComponent(c.req.param('id'))
  if (!/^[0-9]{1,3}\/[A-Za-z0-9]{1,12}$/.test(vehicleId)) {
    return c.json({ error: 'invalid vehicle id' }, 400)
  }
  try {
    const status = await getVehicleTripStatus(vehicleId)
    if (!status) return c.json({ error: 'no active trip' }, 404)
    const stops = status.trip.stopIds.map((id, i) => {
      const meta = liveTransport.getStopMeta(id)
      return {
        index: i,
        stopId: id,
        code: meta?.code ?? null,
        name: meta?.name ?? null,
        scheduled: status.trip.stopScheduled[i] ?? null,
      }
    })
    return c.json({
      vehicleId: status.vehicleId,
      tripId: status.trip.id,
      line: status.trip.line,
      destination: status.trip.destination,
      nextStopIndex: status.nextStop,
      delayMs: status.delayMs,
      stops,
    })
  } catch (err) {
    return c.json(
      { error: 'trip fetch failed', details: err instanceof Error ? err.message : String(err) },
      502
    )
  }
})

app.get('/api/vehicles', (c) => {
  const snapshot = liveTransport.getSnapshot()
  return c.json({ vehicles: snapshot, stats: liveTransport.getStats() })
})

/**
 * SSE stream на vehicle updates. Първото event е пълен snapshot,
 * последващите са delta-та (само променените).
 */
app.get('/api/vehicles/stream', (c) => {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()
      let closed = false

      const send = (event: string, data: unknown) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          closed = true
        }
      }

      const unsubscribe = liveTransport.subscribe((ev) => {
        send(ev.type, ev.vehicles)
      })

      // Heartbeat за да не timeout-не proxy/load balancer-а
      const heartbeat = setInterval(() => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`))
        } catch {
          closed = true
        }
      }, 25_000)

      c.req.raw.signal.addEventListener('abort', () => {
        closed = true
        clearInterval(heartbeat)
        unsubscribe()
        try {
          controller.close()
        } catch {}
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    },
  })
})

const port = parseInt(process.env.PORT ?? '3001', 10)
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`✓ local-api listening on http://localhost:${info.port}`)
  console.log('  Cloudflare Tunnel ще го expose-не публично.')
})

// Start live GPS feed
liveTransport.start().catch((err) => {
  console.error('[livetransport] start failed:', err)
})
