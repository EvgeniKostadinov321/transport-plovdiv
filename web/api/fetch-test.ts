// Тест дали Vercel може да достигне transport.plovdiv.bg
export default async function handler(_req: Request) {
  const start = Date.now()
  try {
    const res = await fetch('http://transport.plovdiv.bg/desktop/', {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(8000),
    })
    const text = await res.text()
    return Response.json({
      ok: true,
      status: res.status,
      bytes: text.length,
      ms: Date.now() - start,
      region: process.env.VERCEL_REGION ?? 'unknown',
      // Показваме първите 200 chars да потвърдим, че е валидно
      preview: text.slice(0, 200),
    })
  } catch (err) {
    const e = err as Error & { cause?: unknown }
    return Response.json(
      {
        ok: false,
        error: e.message,
        name: e.name,
        cause: e.cause ? String(e.cause) : null,
        ms: Date.now() - start,
        region: process.env.VERCEL_REGION ?? 'unknown',
      },
      { status: 500 }
    )
  }
}
