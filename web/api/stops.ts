import { getStaticData } from './_lib/static-data.js'

export const config = {
  runtime: 'nodejs',
}

export default async function handler(_req: Request) {
  try {
    const data = await getStaticData()
    return Response.json(
      { stops: data.stops, loadedAt: data.loadedAt },
      {
        headers: {
          'Cache-Control': 's-maxage=86400, max-age=300',
        },
      }
    )
  } catch (err) {
    return Response.json(
      {
        error: 'static load failed',
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    )
  }
}
