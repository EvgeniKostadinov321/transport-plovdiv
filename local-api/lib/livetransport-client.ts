/**
 * Live vehicle GPS feed клиент към livetransport.eu.
 *
 * Един shared WebSocket connection към `wss://api.livetransport.eu/plovdiv`.
 * Поддържа in-memory snapshot на всички vehicle-и, broadcast-ва updates към
 * subscriber-и (нашите SSE clients).
 *
 * Frame формат (variant с delay, потвърден от spike):
 *   [id, type, lineId, blockId, destination, delay, [lat,lng], bearing, speed, ts]
 *
 * lineId е техен вътрешен ID (напр. "28") — мапва се към публичното име
 * на линия (напр. "6") през bootstrap-а `https://api.livetransport.eu/plovdiv/data`.
 */

const WS_URL = 'wss://api.livetransport.eu/plovdiv'
const BOOTSTRAP_URL = 'https://api.livetransport.eu/plovdiv/data'
/** Vehicle се счита за "stale" ако lastUpdated е по-стар от това. */
const STALE_MS = 90_000
/** GC interval - чистим stale vehicles. */
const GC_INTERVAL_MS = 30_000
/** Reconnect delay (exponential backoff cap-нат тук). */
const RECONNECT_MAX_MS = 30_000

export interface Vehicle {
  /** Stable ID: "type/registration" e.g. "3/PB0533CE". */
  id: string
  /** Публично име на линията (напр. "6", "18"). null ако автобусът не е на линия. */
  line: string | null
  destination: string | null
  lat: number
  lng: number
  /** Посока в градуси (0-359, 0=N, 90=E). */
  bearing: number
  /** Скорост в km/h. */
  speed: number
  /** Закъснение в милисекунди (positive = късно, negative = рано). */
  delayMs: number
  /** Timestamp на последния GPS fix. */
  lastUpdated: number
}

type Listener = (event: { type: 'snapshot' | 'update' | 'remove'; vehicles: Vehicle[] }) => void

interface LineInfo {
  id: string
  type: string
  name: string
}

interface StopInfo {
  id: string
  code: string
  name: { bg?: string; en?: string }
  geo?: { coords: [number, number] }
}

export interface StopMeta {
  /** Public stop number (напр. "1001"). */
  code: string
  name: string
}

class LiveTransportClient {
  private ws: WebSocket | null = null
  private vehicles = new Map<string, Vehicle>()
  /** lineId (тех. вътрешен) → публично име ("28" → "6"). */
  private lineIdToName = new Map<string, string>()
  /** stopId (тех. вътрешен) → { code, name } */
  private stopIdToMeta = new Map<string, StopMeta>()
  private listeners = new Set<Listener>()
  private reconnectDelay = 1000
  private reconnectTimer: NodeJS.Timeout | null = null
  private gcTimer: NodeJS.Timeout | null = null
  private connected = false
  private startedAt = 0
  private frameCount = 0

  async start() {
    await this.loadLineMapping()
    this.connect()
    this.gcTimer = setInterval(() => this.runGC(), GC_INTERVAL_MS)
    this.startedAt = Date.now()
  }

  stop() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.gcTimer) clearInterval(this.gcTimer)
    if (this.ws) this.ws.close(4000)
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    // Immediate snapshot за нов subscriber
    listener({ type: 'snapshot', vehicles: [...this.vehicles.values()] })
    return () => this.listeners.delete(listener)
  }

  getSnapshot(): Vehicle[] {
    return [...this.vehicles.values()]
  }

  /** Mapping техен lineId → публично име ("28" → "6"). За trips-client.ts. */
  getLineName(lineId: string): string | null {
    return this.lineIdToName.get(lineId) ?? null
  }

  /** Mapping техен stopId → public code + name. За trip popup-а. */
  getStopMeta(stopId: string): StopMeta | null {
    return this.stopIdToMeta.get(stopId) ?? null
  }

  getStats() {
    return {
      connected: this.connected,
      vehicleCount: this.vehicles.size,
      framesReceived: this.frameCount,
      uptimeSeconds: this.startedAt ? Math.floor((Date.now() - this.startedAt) / 1000) : 0,
      linesMapped: this.lineIdToName.size,
    }
  }

  private async loadLineMapping() {
    try {
      const res = await fetch(BOOTSTRAP_URL)
      if (!res.ok) throw new Error(`bootstrap ${res.status}`)
      const data = (await res.json()) as { lines?: LineInfo[]; stops?: StopInfo[] }
      for (const line of data.lines ?? []) {
        this.lineIdToName.set(line.id, line.name)
      }
      for (const stop of data.stops ?? []) {
        this.stopIdToMeta.set(stop.id, {
          code: stop.code,
          name: stop.name?.bg ?? stop.name?.en ?? '',
        })
      }
      console.log(
        `[livetransport] bootstrap loaded: ${this.lineIdToName.size} lines, ${this.stopIdToMeta.size} stops`
      )
    } catch (err) {
      console.error('[livetransport] bootstrap load failed:', err)
    }
  }

  private connect() {
    console.log(`[livetransport] connecting to ${WS_URL}`)
    const ws = new WebSocket(WS_URL)
    this.ws = ws

    ws.addEventListener('open', () => {
      console.log('[livetransport] WS open')
      this.connected = true
      this.reconnectDelay = 1000
    })

    ws.addEventListener('message', (event) => {
      const raw = typeof event.data === 'string' ? event.data : null
      if (!raw) return
      try {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) this.handleFrame(parsed)
      } catch (err) {
        console.error('[livetransport] frame parse error:', err)
      }
    })

    ws.addEventListener('error', (e) => {
      console.error('[livetransport] WS error', (e as ErrorEvent).message ?? '')
    })

    ws.addEventListener('close', (e) => {
      this.connected = false
      this.ws = null
      console.log(`[livetransport] WS close code=${e.code}`)
      if (e.code === 4000) return
      this.scheduleReconnect()
    })
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return
    const delay = this.reconnectDelay
    console.log(`[livetransport] reconnect in ${delay}ms`)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS)
      this.connect()
    }, delay)
  }

  private handleFrame(arr: any[]) {
    this.frameCount++
    const updated: Vehicle[] = []
    for (const t of arr) {
      const v = this.parseTuple(t)
      if (!v) continue
      this.vehicles.set(v.id, v)
      updated.push(v)
    }
    if (updated.length === 0) return
    for (const listener of this.listeners) {
      listener({ type: 'update', vehicles: updated })
    }
  }

  /**
   * Parsing на variant B (с delay). Coords се search-ват dynamic-но защото
   * някои frames може да идват с другия variant.
   */
  private parseTuple(t: any): Vehicle | null {
    if (!Array.isArray(t) || t.length < 8) return null
    let coordsIdx = -1
    for (let i = 5; i < Math.min(t.length, 8); i++) {
      if (Array.isArray(t[i]) && t[i].length === 2 && typeof t[i][0] === 'number') {
        coordsIdx = i
        break
      }
    }
    if (coordsIdx === -1) return null
    const id = typeof t[0] === 'string' ? t[0] : String(t[0])
    const lineId = t[2] != null ? String(t[2]) : null
    const destination =
      t[4] && typeof t[4] === 'object' && t[4].bg
        ? String(t[4].bg)
        : t[4] != null
          ? String(t[4])
          : null
    const delayMs = coordsIdx === 6 ? Number(t[5]) || 0 : 0
    const [lat, lng] = t[coordsIdx] as [number, number]
    const bearing = Number(t[coordsIdx + 1]) || 0
    const speed = Number(t[coordsIdx + 2]) || 0
    const lastUpdated = Number(t[coordsIdx + 3]) || Date.now()
    return {
      id,
      line: lineId ? (this.lineIdToName.get(lineId) ?? null) : null,
      destination,
      lat,
      lng,
      bearing,
      speed,
      delayMs,
      lastUpdated,
    }
  }

  private runGC() {
    const now = Date.now()
    const removed: Vehicle[] = []
    for (const [id, v] of this.vehicles) {
      if (now - v.lastUpdated > STALE_MS) {
        removed.push(v)
        this.vehicles.delete(id)
      }
    }
    if (removed.length === 0) return
    for (const listener of this.listeners) {
      listener({ type: 'remove', vehicles: removed })
    }
  }
}

export const liveTransport = new LiveTransportClient()
