/**
 * Cloudflare Worker proxy за transport.plovdiv.bg
 *
 * Vercel functions ползват този worker за да правят заявки към
 * общинския сайт (който блокира datacenter IPs).
 *
 * URL: https://<your-worker>.workers.dev/desktop/  → http://transport.plovdiv.bg/desktop/
 * URL: https://<your-worker>.workers.dev/zkau?...   → http://transport.plovdiv.bg/zkau?...
 *
 * Запазваме:
 *   - HTTP method, headers, body
 *   - Set-Cookie (за session continuation)
 *   - Status code, response body
 */

interface Env {
  // Споделено secret между Vercel и Worker за минимална авторизация
  PROXY_SECRET?: string
}

const UPSTREAM_HOST = 'transport.plovdiv.bg'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Минимална auth - изисква x-proxy-secret header за всяка заявка
    if (env.PROXY_SECRET) {
      const provided = request.headers.get('x-proxy-secret')
      if (provided !== env.PROXY_SECRET) {
        return new Response('forbidden', { status: 403 })
      }
    }

    const url = new URL(request.url)

    // Health check
    if (url.pathname === '/' || url.pathname === '/health') {
      return Response.json({ ok: true, ts: Date.now() })
    }

    // Construct upstream URL - запазваме path и query
    const upstreamUrl = `http://${UPSTREAM_HOST}${url.pathname}${url.search}`

    // Forward headers без host
    const headers = new Headers()
    for (const [name, value] of request.headers) {
      const lower = name.toLowerCase()
      if (
        lower === 'host' ||
        lower === 'x-proxy-secret' ||
        lower.startsWith('cf-') ||
        lower.startsWith('x-forwarded-') ||
        lower.startsWith('x-real-ip')
      ) {
        continue
      }
      headers.set(name, value)
    }

    // Запазваме реалния Host
    headers.set('Host', UPSTREAM_HOST)

    // Default User-Agent ако клиентът не е изпратил
    if (!headers.has('User-Agent')) {
      headers.set(
        'User-Agent',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'
      )
    }

    try {
      const upstreamRes = await fetch(upstreamUrl, {
        method: request.method,
        headers,
        body:
          request.method !== 'GET' && request.method !== 'HEAD'
            ? await request.arrayBuffer()
            : undefined,
        // CF Workers поддържат до 30s subrequest
        redirect: 'manual',
      })

      // Forward response headers - но премахваме CSP/HSTS които биха counter-broken проксито
      const respHeaders = new Headers()
      for (const [name, value] of upstreamRes.headers) {
        const lower = name.toLowerCase()
        if (
          lower === 'content-security-policy' ||
          lower === 'strict-transport-security' ||
          lower === 'content-length'
        ) {
          continue
        }
        respHeaders.set(name, value)
      }

      // Cache control - да не cache-ва CF edge
      respHeaders.set('Cache-Control', 'no-store')

      return new Response(upstreamRes.body, {
        status: upstreamRes.status,
        statusText: upstreamRes.statusText,
        headers: respHeaders,
      })
    } catch (err) {
      return Response.json(
        {
          error: 'proxy fetch failed',
          message: err instanceof Error ? err.message : String(err),
        },
        { status: 502 }
      )
    }
  },
}
