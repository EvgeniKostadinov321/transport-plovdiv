// Minimal endpoint без external imports - sanity check
export default async function handler(_req: Request) {
  return Response.json({
    ok: true,
    msg: 'hello from vercel',
    nodeVersion: process.version,
    region: process.env.VERCEL_REGION ?? 'unknown',
    ts: Date.now(),
  })
}
