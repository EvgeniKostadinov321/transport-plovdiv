// Генерира PWA иконки от favicon.svg
import sharp from 'sharp'
import { readFile, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PUBLIC = join(__dirname, '..', 'public')

const SIZES = [
  { name: 'pwa-192x192.png', size: 192 },
  { name: 'pwa-512x512.png', size: 512 },
  { name: 'apple-touch-icon.png', size: 180 },
  { name: 'favicon-32x32.png', size: 32 },
  { name: 'favicon-16x16.png', size: 16 },
]

async function main() {
  const svg = await readFile(join(PUBLIC, 'favicon.svg'))
  for (const { name, size } of SIZES) {
    const out = join(PUBLIC, name)
    await sharp(svg).resize(size, size).png().toFile(out)
    console.log(`✓ ${name} (${size}x${size})`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
