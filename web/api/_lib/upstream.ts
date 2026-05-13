/**
 * Upstream fetch wrapper.
 *
 * Ако имаме PROXY_URL env var → ползваме Cloudflare Worker proxy.
 * (Vercel datacenter IPs са блокирани от transport.plovdiv.bg.)
 * Иначе → directly към transport.plovdiv.bg (само за локално dev).
 */

const UPSTREAM_HOST = 'http://transport.plovdiv.bg'

export function upstreamUrl(path: string): string {
  const proxy = process.env.PROXY_URL
  if (proxy) {
    return `${proxy.replace(/\/$/, '')}${path}`
  }
  return `${UPSTREAM_HOST}${path}`
}

export function withProxyAuth(headers: Record<string, string> = {}): Record<string, string> {
  const result = { ...headers }
  const secret = process.env.PROXY_SECRET
  if (secret) result['x-proxy-secret'] = secret
  return result
}
